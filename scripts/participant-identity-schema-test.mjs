import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { createMigratedDatabase } from './sqlite-fixture.mjs'

function expectDatabaseError(database, sql, expectedMessage) {
  assert.throws(
    () => database.exec(sql),
    error => {
      assert.match(error.message, new RegExp(expectedMessage))
      return true
    },
    `database should reject: ${sql}`,
  )
}

const database = await createMigratedDatabase()

try {
  const identityMigration = await readFile(
    new URL('../cloudflare/d1/0009_participant_identity.sql', import.meta.url),
    'utf8',
  )
  database.exec(identityMigration)

  database.exec(`
    INSERT INTO game (id, slug, name) VALUES (1, 'cs2', 'CS2');
    INSERT INTO tournament (
      id, slug, title, game_id, season, edition, status, team_cap
    ) VALUES (
      1, 'identity-cup', 'Identity Cup', 1, '2026', 1, 'registration', 4
    );
    INSERT INTO team (id, tournament_id, name, tag, captain, contact)
    VALUES
      (10, 1, 'Alpha', 'AAA', 'Captain A', 'private-a'),
      (11, 1, 'Bravo', 'BBB', 'Captain B', 'private-b');
  `)

  const principalIds = {
    alpha: `p_${'a'.repeat(43)}`,
    bravo: `p_${'b'.repeat(43)}`,
    charlie: `p_${'c'.repeat(43)}`,
    missing: `p_${'z'.repeat(43)}`,
  }
  const handles = {
    alpha: 'A'.repeat(43),
    bravo: 'B'.repeat(43),
    charlie: 'C'.repeat(43),
  }
  const insertPrincipal = database.prepare(
    'INSERT INTO participant_principal (id, webauthn_user_handle) VALUES (?, ?)',
  )
  for (const name of ['alpha', 'bravo', 'charlie']) {
    insertPrincipal.run(principalIds[name], handles[name])
  }

  assert.deepEqual(
    new Set(
      database
        .prepare('PRAGMA table_info(participant_principal)')
        .all()
        .map(column => column.name),
    ),
    new Set(['id', 'webauthn_user_handle', 'created_at']),
  )
  expectDatabaseError(
    database,
    `INSERT INTO participant_principal (id, webauthn_user_handle) VALUES ('p_${'d'.repeat(43)}', '${handles.alpha}');`,
    'UNIQUE constraint failed',
  )
  for (const sql of [
    `INSERT INTO participant_principal (id, webauthn_user_handle) VALUES ('participant-1', '${'D'.repeat(43)}');`,
    `INSERT INTO participant_principal (id, webauthn_user_handle) VALUES ('p_${'e'.repeat(43)}', 'captain@example.com');`,
  ]) {
    expectDatabaseError(database, sql, 'CHECK constraint failed')
  }

  const insertIdentity = database.prepare(
    `
      INSERT INTO participant_external_identity (
        principal_id, provider, issuer, subject
      ) VALUES (?, ?, ?, ?)
    `,
  )
  insertIdentity.run(principalIds.alpha, 'oidc', 'https://identity.example/tenant-a', 'Student-1')
  insertIdentity.run(principalIds.bravo, 'oidc', 'https://identity.example/tenant-b', 'Student-1')
  insertIdentity.run(principalIds.bravo, 'oidc', 'https://identity.example/tenant-a', 'student-1')
  assert.equal(
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM participant_external_identity WHERE subject IN ('Student-1', 'student-1')",
      )
      .get().count,
    3,
    'issuer and case-sensitive subject must remain part of identity namespace',
  )
  expectDatabaseError(
    database,
    `INSERT INTO participant_external_identity (principal_id, provider, issuer, subject) VALUES ('${principalIds.bravo}', 'oidc', 'https://identity.example/tenant-a', 'Student-1');`,
    'UNIQUE constraint failed',
  )
  expectDatabaseError(
    database,
    `INSERT INTO participant_external_identity (principal_id, provider, issuer, subject) VALUES ('${principalIds.missing}', 'oidc', 'https://identity.example/tenant-a', 'missing');`,
    'FOREIGN KEY constraint failed',
  )

  database
    .prepare('INSERT INTO participant_profile (principal_id, display_name) VALUES (?, ?)')
    .run(principalIds.alpha, '参赛者 Alpha')
  expectDatabaseError(
    database,
    `INSERT INTO participant_profile (principal_id, display_name) VALUES ('${principalIds.alpha}', 'Duplicate');`,
    'UNIQUE constraint failed',
  )
  expectDatabaseError(
    database,
    `INSERT INTO participant_profile (principal_id, display_name) VALUES ('${principalIds.missing}', 'Missing');`,
    'FOREIGN KEY constraint failed',
  )

  assert.equal(
    database
      .prepare('SELECT COUNT(*) AS count FROM tournament_entry_owner WHERE team_id = 10')
      .get().count,
    0,
    'anonymous registrations must remain valid without an owner',
  )
  database
    .prepare('INSERT INTO tournament_entry_owner (team_id, principal_id) VALUES (?, ?)')
    .run(10, principalIds.alpha)
  assert.equal(
    database.prepare('SELECT claim_method FROM tournament_entry_owner WHERE team_id = 10').get()
      .claim_method,
    'management_token',
  )
  expectDatabaseError(
    database,
    `INSERT INTO tournament_entry_owner (team_id, principal_id) VALUES (10, '${principalIds.bravo}');`,
    'UNIQUE constraint failed',
  )
  for (const sql of [
    `INSERT INTO tournament_entry_owner (team_id, principal_id) VALUES (999, '${principalIds.alpha}');`,
    `INSERT INTO tournament_entry_owner (team_id, principal_id) VALUES (11, '${principalIds.missing}');`,
  ]) {
    expectDatabaseError(database, sql, 'FOREIGN KEY constraint failed')
  }
  expectDatabaseError(
    database,
    `INSERT INTO tournament_entry_owner (team_id, principal_id, claim_method) VALUES (11, '${principalIds.bravo}', 'unverified');`,
    'CHECK constraint failed',
  )

  database
    .prepare(
      "UPDATE tournament_entry_owner SET principal_id = ?, claim_method = 'verified_transfer' WHERE team_id = 10",
    )
    .run(principalIds.bravo)
  expectDatabaseError(
    database,
    `DELETE FROM participant_principal WHERE id = '${principalIds.bravo}';`,
    'FOREIGN KEY constraint failed',
  )
  database.exec(`DELETE FROM participant_principal WHERE id = '${principalIds.alpha}';`)
  assert.equal(
    database
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM participant_external_identity
          WHERE principal_id = '${principalIds.alpha}'
        `,
      )
      .get().count,
    0,
    'identity and profile rows must follow a deleted unowned principal',
  )
  database.exec('DELETE FROM team WHERE id = 10;')
  assert.equal(
    database
      .prepare('SELECT COUNT(*) AS count FROM tournament_entry_owner WHERE team_id = 10')
      .get().count,
    0,
    'ownership must follow its tournament entry',
  )

  const privateRelations = [
    'participant_principal',
    'participant_external_identity',
    'participant_profile',
    'tournament_entry_owner',
  ]
  const privateColumns = [
    'contact',
    'display_name',
    'claim_method',
    'management_token_hash',
    'management_write_nonce',
    'principal_id',
    'webauthn_user_handle',
    'provider',
    'issuer',
    'subject',
  ]
  const publicViews = database
    .prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'view' AND name LIKE '%_public'")
    .all()
  assert.ok(publicViews.length > 0)
  for (const view of publicViews) {
    for (const relation of privateRelations) {
      assert.doesNotMatch(view.sql.toLowerCase(), new RegExp(`\\b${relation}\\b`))
    }
    const columns = new Set(
      database
        .prepare(`PRAGMA table_info(${view.name})`)
        .all()
        .map(column => column.name),
    )
    for (const column of privateColumns) assert.equal(columns.has(column), false)
  }

  console.log('participant identity schema tests passed')
} finally {
  database.close()
}

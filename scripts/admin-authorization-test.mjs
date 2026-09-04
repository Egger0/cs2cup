import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'

import { STAFF_CAPABILITIES, hasStaffCapability, staffRoleAllows } from '../lib/authorization.ts'
import { createMigratedDatabase, migrationFiles } from './sqlite-fixture.mjs'

const now = 2_000_000_000_000
const principal = suffix => `p_${suffix.repeat(43)}`
const userHandle = suffix => suffix.repeat(43)

function d1Adapter(database) {
  return {
    prepare(query) {
      const statement = database.prepare(query)
      let bindings = []
      const prepared = {
        bind(...values) {
          bindings = values
          return prepared
        },
        async first() {
          return statement.get(...bindings) ?? null
        },
      }
      return prepared
    },
  }
}

const database = await createMigratedDatabase()
const db = d1Adapter(database)
const platform = { kind: 'platform' }
const tournament = tournamentId => ({ kind: 'tournament', tournamentId })
const participant = suffix => ({ kind: 'participant', principalId: principal(suffix) })

async function verifyUpgradeBackfill() {
  const upgrade = new DatabaseSync(':memory:')
  upgrade.exec('PRAGMA foreign_keys = ON')
  try {
    for (const file of await migrationFiles()) {
      if (file === '0012_staff_authorization.sql') break
      upgrade.exec(await readFile(new URL(`../cloudflare/d1/${file}`, import.meta.url), 'utf8'))
    }
    upgrade.exec(
      "INSERT INTO admin_account (id, username, password_salt, password_hash) VALUES (1, 'existing', 'salt', 'hash')",
    )
    const authorizationMigration = await readFile(
      new URL('../cloudflare/d1/0012_staff_authorization.sql', import.meta.url),
      'utf8',
    )
    upgrade.exec(authorizationMigration)
    upgrade.exec(authorizationMigration)
    assert.deepEqual(
      { ...upgrade.prepare('SELECT admin_id, role FROM platform_role_assignment').get() },
      { admin_id: 1, role: 'platform_owner' },
      'an upgrade must backfill exactly one explicit owner assignment',
    )
  } finally {
    upgrade.close()
  }
}

await verifyUpgradeBackfill()

try {
  database.exec(`
    INSERT INTO game (id, slug, name) VALUES (1, 'cs2', 'CS2');
    INSERT INTO tournament (id, slug, title, season, edition, status, team_cap)
    VALUES
      (1, 'first', 'First Cup', '2026', 1, 'running', 8),
      (2, 'second', 'Second Cup', '2026', 2, 'registration', 8);
    INSERT INTO admin_account (id, username, password_salt, password_hash)
    VALUES (1, 'owner', 'salt', 'hash');
    INSERT INTO participant_principal (id, webauthn_user_handle)
    VALUES
      ('${principal('a')}', '${userHandle('a')}'),
      ('${principal('b')}', '${userHandle('b')}'),
      ('${principal('c')}', '${userHandle('c')}'),
      ('${principal('d')}', '${userHandle('d')}'),
      ('${principal('e')}', '${userHandle('e')}');
    INSERT INTO tournament_role_assignment
      (tournament_id, principal_id, role, granted_at, expires_at)
    VALUES
      (1, '${principal('a')}', 'check_in_operator', ${now - 1_000}, ${now + 1_000}),
      (1, '${principal('b')}', 'organizer', ${now - 1_000}, NULL),
      (1, '${principal('c')}', 'referee', ${now - 1_000}, NULL),
      (1, '${principal('d')}', 'organizer', ${now - 2_000}, ${now});
    INSERT INTO tournament_role_assignment
      (tournament_id, principal_id, role, granted_at, revoked_at)
    VALUES (1, '${principal('e')}', 'organizer', ${now - 2_000}, ${now - 1_000});
  `)

  assert.deepEqual(
    { ...database.prepare('SELECT admin_id, role FROM platform_role_assignment').get() },
    { admin_id: 1, role: 'platform_owner' },
    'creating the singleton admin must create its explicit compatibility assignment',
  )

  const owner = { kind: 'admin', adminId: 1 }
  assert.equal(await hasStaffCapability(db, owner, 'platform.manage', platform, now), true)
  for (const capability of STAFF_CAPABILITIES.filter(value => value !== 'platform.manage')) {
    assert.equal(await hasStaffCapability(db, owner, capability, tournament(2), now), true)
  }

  database.exec(`
    SAVEPOINT mapped_admin_authorization;
    INSERT INTO identity_account
      (id, webauthn_user_handle, display_name, status, verification_state, created_at, updated_at)
    VALUES ('${'M'.repeat(43)}', '${'M'.repeat(43)}', 'Migrated owner',
            'active', 'verified', 1, 1);
    INSERT INTO identity_legacy_subject_map
      (subject_type, subject_id, account_id, source_revision, source_snapshot_hash,
       migration_version, mapped_at)
    VALUES ('admin_account', '1', '${'M'.repeat(43)}', 0, '${'f'.repeat(64)}', 1, 1);
  `)
  assert.equal(await hasStaffCapability(db, owner, 'platform.manage', platform, now), false)
  assert.equal(
    await hasStaffCapability(db, owner, 'tournament.check_in.write', tournament(2), now),
    false,
  )
  database.exec('ROLLBACK TO mapped_admin_authorization; RELEASE mapped_admin_authorization')

  const checkIn = participant('a')
  for (const capability of [
    'tournament.view',
    'tournament.check_in.read',
    'tournament.check_in.write',
  ]) {
    assert.equal(await hasStaffCapability(db, checkIn, capability, tournament(1), now), true)
  }
  assert.equal(
    await hasStaffCapability(db, checkIn, 'tournament.entries.review', tournament(1), now),
    false,
  )
  assert.equal(
    await hasStaffCapability(db, checkIn, 'tournament.check_in.read', tournament(2), now),
    false,
    'a tournament assignment must not cross scope',
  )
  database.exec(`
    SAVEPOINT mapped_participant_authorization;
    INSERT INTO identity_account
      (id, webauthn_user_handle, display_name, status, verification_state, created_at, updated_at)
    VALUES ('${'N'.repeat(43)}', '${userHandle('a')}', 'Migrated participant',
            'active', 'legacy_unverified', 1, 1);
    INSERT INTO identity_legacy_subject_map
      (subject_type, subject_id, account_id, source_revision, source_snapshot_hash,
       migration_version, mapped_at)
    VALUES ('participant_principal', '${principal('a')}', '${'N'.repeat(43)}', 0,
            '${'e'.repeat(64)}', 1, 1);
  `)
  assert.equal(await hasStaffCapability(db, checkIn, 'tournament.view', tournament(1), now), false)
  database.exec(
    'ROLLBACK TO mapped_participant_authorization; RELEASE mapped_participant_authorization',
  )

  assert.equal(
    await hasStaffCapability(db, participant('b'), 'tournament.media.manage', tournament(1), now),
    true,
  )
  assert.equal(
    await hasStaffCapability(db, participant('c'), 'tournament.results.write', tournament(1), now),
    true,
  )
  assert.equal(
    await hasStaffCapability(db, participant('c'), 'tournament.check_in.write', tournament(1), now),
    false,
  )
  for (const suffix of ['d', 'e']) {
    assert.equal(
      await hasStaffCapability(db, participant(suffix), 'tournament.view', tournament(1), now),
      false,
      `${suffix} assignment must be inactive`,
    )
  }

  assert.equal(await hasStaffCapability(db, checkIn, 'platform.manage', platform, now), false)
  assert.equal(await hasStaffCapability(db, owner, 'platform.manage', tournament(1), now), false)
  assert.equal(
    await hasStaffCapability(db, { kind: 'admin', adminId: 0 }, 'platform.manage', platform, now),
    false,
  )
  assert.equal(
    await hasStaffCapability(db, participant('a'), 'tournament.view', tournament(0), now),
    false,
  )

  assert.equal(staffRoleAllows('organizer', 'tournament.configure'), true)
  assert.equal(staffRoleAllows('referee', 'tournament.configure'), false)
  assert.equal(staffRoleAllows('unknown', 'tournament.view'), false)

  database.exec(`UPDATE platform_role_assignment SET revoked_at = ${now} WHERE admin_id = 1`)
  assert.equal(
    await hasStaffCapability(db, owner, 'platform.manage', platform, now + 1),
    false,
    'admin id 1 must not bypass a revoked assignment',
  )

  for (const sql of [
    `INSERT INTO tournament_role_assignment
      (tournament_id, principal_id, role) VALUES (1, '${principal('a')}', 'unknown')`,
    `INSERT INTO tournament_role_assignment
      (tournament_id, principal_id, role) VALUES (999, '${principal('a')}', 'organizer')`,
    `INSERT INTO tournament_role_assignment
      (tournament_id, principal_id, role) VALUES (1, '${principal('z')}', 'organizer')`,
    `INSERT INTO tournament_role_assignment
      (tournament_id, principal_id, role, granted_at, expires_at)
      VALUES (2, '${principal('a')}', 'organizer', ${now}, ${now})`,
  ]) {
    assert.throws(() => database.exec(sql))
  }

  database.exec('DELETE FROM tournament WHERE id = 1')
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM tournament_role_assignment').get().count,
    0,
    'deleting a tournament must remove its scoped assignments',
  )
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
  console.log('admin authorization matrix and schema tests passed')
} finally {
  database.close()
}

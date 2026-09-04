import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') {
      return { url: 'data:text/javascript,export {}', shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const { migrateLegacyParticipantCredential } =
  await import('../lib/identity/legacy-participant-migration.ts')
const { passkeyAuthenticationCredential } =
  await import('../lib/identity/internal/passkey-authentication.ts')
const { createMigratedDatabase } = await import('./sqlite-fixture.mjs')

function adapter(database) {
  return {
    prepare(query) {
      const statement = database.prepare(query)
      let bindings = []
      const bound = {
        async first() {
          return statement.get(...bindings) ?? null
        },
        async all() {
          return { results: statement.all(...bindings) }
        },
        async run() {
          return statement.run(...bindings)
        },
      }
      return {
        bind(...values) {
          bindings = values
          return bound
        },
      }
    },
    async batch(statements) {
      database.exec('BEGIN IMMEDIATE')
      try {
        const results = []
        for (const statement of statements) results.push(await statement.run())
        database.exec('COMMIT')
        return results
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },
  }
}

const opaque = character => character.repeat(43)
const database = await createMigratedDatabase()
const db = adapter(database)
const now = Date.now()
const principalId = `p_${opaque('P')}`
const credentialId = 'legacy-credential-primary'

try {
  database.exec(`
    INSERT INTO game (id, slug, name) VALUES (92, 'legacy-migration', 'Legacy Migration');
    INSERT INTO tournament (id, slug, title, game_id, season, edition, status, team_cap)
    VALUES
      (92, 'legacy-migration', 'Legacy Migration', 92, '2026', 1, 'registration', 8),
      (93, 'legacy-expired-role', 'Legacy Expired Role', 92, '2026', 2, 'finished', 8),
      (94, 'legacy-revoked-role', 'Legacy Revoked Role', 92, '2026', 3, 'finished', 8);
    INSERT INTO team (id, tournament_id, name, tag, captain, contact)
    VALUES (920, 92, 'Legacy Team', 'LGC', 'Legacy Captain', 'private');
  `)
  database
    .prepare(
      `INSERT INTO participant_principal (id, webauthn_user_handle, created_at)
       VALUES (?, ?, '2026-01-01 00:00:00')`,
    )
    .run(principalId, opaque('H'))
  database
    .prepare('INSERT INTO participant_profile (principal_id, display_name) VALUES (?, ?)')
    .run(principalId, '迁移用户')
  const insertCredential = database.prepare(
    `INSERT INTO participant_passkey_credential
      (credential_id, principal_id, public_key, counter, transports_json, device_type,
       backed_up, created_at)
     VALUES (?, ?, ?, ?, '["internal"]', 'multiDevice', 1, ?)`,
  )
  insertCredential.run(
    credentialId,
    principalId,
    Buffer.from('legacy-public-key').toString('base64url'),
    4,
    now - 2_000,
  )
  insertCredential.run(
    'legacy-credential-secondary',
    principalId,
    Buffer.from('legacy-secondary-key').toString('base64url'),
    1,
    now - 1_000,
  )
  database
    .prepare(
      `INSERT INTO tournament_entry_owner (team_id, principal_id, claim_method)
       VALUES (920, ?, 'management_token')`,
    )
    .run(principalId)
  database
    .prepare(
      `INSERT INTO tournament_role_assignment
        (tournament_id, principal_id, role, granted_at, expires_at, revoked_at)
       VALUES
        (92, ?, 'check_in_operator', ?, ?, NULL),
        (92, ?, 'organizer', ?, NULL, NULL),
        (92, ?, 'referee', ?, NULL, NULL),
        (93, ?, 'check_in_operator', ?, ?, NULL),
        (94, ?, 'check_in_operator', ?, ?, ?)`,
    )
    .run(
      principalId,
      now - 5_000,
      now + 60_000,
      principalId,
      now - 4_000,
      principalId,
      now - 3_000,
      principalId,
      now - 10_000,
      now - 1,
      principalId,
      now - 10_000,
      now + 60_000,
      now - 1,
    )

  const legacyCredential = await passkeyAuthenticationCredential(db, credentialId, now)
  assert.equal(legacyCredential.source, 'legacy_participant')
  assert.equal(legacyCredential.counter, 4)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM identity_account').get().count, 0)
  const accountId = await migrateLegacyParticipantCredential(db, credentialId, now)
  assert.match(accountId, /^[A-Za-z0-9_-]{43}$/)
  const migratedCredential = await passkeyAuthenticationCredential(db, credentialId, now)
  assert.equal(migratedCredential.source, 'identity')
  assert.equal(migratedCredential.accountId, accountId)
  assert.equal(await migrateLegacyParticipantCredential(db, credentialId, now + 1), accountId)
  assert.deepEqual(
    {
      ...database
        .prepare(
          `SELECT account.display_name, account.status, account.verification_state, cutover.phase
           FROM identity_account AS account
           JOIN identity_cutover AS cutover ON cutover.account_id = account.id
           WHERE account.id = ?`,
        )
        .get(accountId),
    },
    {
      display_name: '迁移用户',
      status: 'active',
      verification_state: 'legacy_unverified',
      phase: 3,
    },
  )
  assert.equal(
    database
      .prepare('SELECT COUNT(*) AS count FROM identity_passkey_credential WHERE account_id = ?')
      .get(accountId).count,
    2,
  )
  assert.deepEqual(
    {
      ...database
        .prepare(
          `SELECT relationship, grant_reason FROM identity_registration_membership
           WHERE account_id = ? AND team_id = 920`,
        )
        .get(accountId),
    },
    { relationship: 'owner', grant_reason: 'legacy participant migration' },
  )
  assert.equal(
    database
      .prepare(
        `SELECT account_id FROM identity_legacy_subject_map
         WHERE subject_type = 'participant_principal' AND subject_id = ?`,
      )
      .get(principalId).account_id,
    accountId,
  )
  assert.deepEqual(
    database
      .prepare(
        `SELECT role, scope_tournament_id AS tournament_id, granted_at, expires_at
         FROM identity_role_assignment WHERE account_id = ?
         ORDER BY role`,
      )
      .all(accountId)
      .map(row => ({ ...row })),
    [
      {
        role: 'check_in_operator',
        tournament_id: 92,
        granted_at: now - 5_000,
        expires_at: now + 60_000,
      },
      {
        role: 'organizer',
        tournament_id: 92,
        granted_at: now - 4_000,
        expires_at: null,
      },
      {
        role: 'referee',
        tournament_id: 92,
        granted_at: now - 3_000,
        expires_at: null,
      },
    ],
  )

  const mapRevision = database
    .prepare(
      `SELECT revision FROM identity_legacy_subject_map
       WHERE subject_type = 'participant_principal' AND subject_id = ?`,
    )
    .get(principalId).revision
  database
    .prepare(
      `UPDATE identity_registration_membership
       SET revoked_at = ?, revoke_reason = 'Unified owner revocation',
           revision = revision + 1, write_nonce = ?
       WHERE account_id = ? AND team_id = 920 AND relationship = 'owner'
         AND revoked_at IS NULL`,
    )
    .run(now + 2, opaque('U'), accountId)
  database
    .prepare(
      `UPDATE identity_role_assignment
       SET revoked_at = ?, revoke_reason = 'Unified role revocation',
           revision = revision + 1, write_nonce = ?
       WHERE account_id = ? AND scope_tournament_id = 92 AND role = 'check_in_operator'
         AND revoked_at IS NULL`,
    )
    .run(now + 2, opaque('V'), accountId)

  assert.equal(await migrateLegacyParticipantCredential(db, credentialId, now + 3), accountId)
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM identity_registration_membership
         WHERE account_id = ? AND team_id = 920 AND relationship = 'owner'`,
      )
      .get(accountId).count,
    1,
  )
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM identity_registration_membership
         WHERE account_id = ? AND team_id = 920 AND relationship = 'owner'
           AND revoked_at IS NULL`,
      )
      .get(accountId).count,
    0,
  )
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM identity_role_assignment
         WHERE account_id = ? AND scope_tournament_id = 92 AND role = 'check_in_operator'`,
      )
      .get(accountId).count,
    1,
  )
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM identity_role_assignment
         WHERE account_id = ? AND scope_tournament_id = 92 AND role = 'check_in_operator'
           AND revoked_at IS NULL`,
      )
      .get(accountId).count,
    0,
  )
  assert.equal(
    database
      .prepare(
        `SELECT revision FROM identity_legacy_subject_map
         WHERE subject_type = 'participant_principal' AND subject_id = ?`,
      )
      .get(principalId).revision,
    mapRevision,
  )
} finally {
  database.close()
}

console.log('identity legacy participant migration tests passed')

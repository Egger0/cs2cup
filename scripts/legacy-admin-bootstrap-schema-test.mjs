import assert from 'node:assert/strict'

import {
  account,
  createUnifiedIdentitySchemaFixture,
  hash,
  opaque,
} from './unified-identity-schema-fixture.mjs'

const { database, execute, expectError } = await createUnifiedIdentitySchemaFixture()

const legacySessionHash = hash('4')
const ownerAccountId = opaque('L')
const ownerCredentialId = opaque('M')
const ownerRoleId = opaque('N')

try {
  execute(
    `INSERT INTO admin_account (id, username, password_salt, password_hash)
     VALUES (1, 'legacy-owner', 'legacy-salt', 'legacy-hash')`,
  )
  execute(`INSERT INTO admin_session (token_hash, admin_id, expires_at) VALUES (?, 1, 1000)`, [
    legacySessionHash,
  ])
  const bootstrapInsert = `INSERT INTO identity_legacy_admin_bootstrap
    (legacy_admin_id, secret_hash, legacy_session_token_hash, expected_account_id,
     issued_at, expires_at)
   VALUES (1, ?, ?, ?, 100, 900)`
  expectError(
    () => execute(bootstrapInsert, [hash('5'), hash('6'), ownerAccountId]),
    /current singleton admin/,
  )
  execute(bootstrapInsert, [hash('5'), legacySessionHash, ownerAccountId])
  database.exec('SAVEPOINT close_bootstrap_test')
  execute(
    `UPDATE identity_legacy_admin_bootstrap
     SET status = 'closed', closed_at = 150, close_reason = 'Bootstrap deliberately disabled',
         revision = 1, write_nonce = ? WHERE legacy_admin_id = 1`,
    [opaque('T')],
  )
  expectError(
    () =>
      execute(
        `UPDATE identity_legacy_admin_bootstrap
         SET status = 'open', closed_at = NULL, close_reason = NULL,
             revision = 2, write_nonce = ? WHERE legacy_admin_id = 1`,
        [opaque('U')],
      ),
    /state conflict/,
  )
  database.exec('ROLLBACK TO close_bootstrap_test; RELEASE close_bootstrap_test')
  expectError(
    () =>
      execute(
        `INSERT OR REPLACE INTO identity_legacy_admin_bootstrap
          (legacy_admin_id, secret_hash, legacy_session_token_hash, expected_account_id,
           issued_at, expires_at)
         VALUES (1, ?, ?, ?, 100, 900)`,
        [hash('5'), legacySessionHash, ownerAccountId],
      ),
    /insert conflict/,
  )
  execute(
    `INSERT INTO identity_account
      (id, webauthn_user_handle, display_name, status, verification_state, created_at, updated_at)
     VALUES (?, ?, 'Legacy Owner', 'active', 'legacy_unverified', 150, 150)`,
    [ownerAccountId, opaque('l')],
  )
  execute(
    `INSERT INTO identity_password_credential
      (id, account_id, username, algorithm, parameters_json, salt, password_hash,
       pepper_version, registration_kind, legacy_admin_bootstrap_id, created_at, updated_at)
     VALUES (?, ?, 'cup.owner', 'argon2id', '{"m":65536,"t":3,"p":1}', ?, ?, 1,
       'legacy_admin_bootstrap', 1, 200, 200)`,
    [ownerCredentialId, ownerAccountId, Buffer.alloc(16, 1), Buffer.alloc(32, 2)],
  )
  execute(
    `UPDATE identity_legacy_admin_bootstrap
     SET status = 'consumed', consumed_at = 250, consume_nonce = ?,
         password_credential_id = ?, revision = 1, write_nonce = ?
     WHERE legacy_admin_id = 1`,
    [opaque('O'), ownerCredentialId, opaque('P')],
  )
  execute(
    `INSERT INTO identity_role_assignment
      (id, account_id, role, scope_type, grant_reason, granted_at)
     VALUES (?, ?, 'platform_owner', 'platform', 'Legacy singleton owner bootstrap', 260)`,
    [ownerRoleId, ownerAccountId],
  )
  execute(
    `UPDATE identity_legacy_admin_bootstrap
     SET status = 'completed', owner_role_assignment_id = ?, completed_at = 260,
         revision = 2, write_nonce = ? WHERE legacy_admin_id = 1`,
    [ownerRoleId, opaque('R')],
  )
  execute(
    `INSERT INTO identity_role_assignment
      (id, account_id, role, scope_type, grant_reason, granted_at)
     VALUES (?, ?, 'platform_owner', 'platform', 'Shared platform ownership', 261)`,
    [opaque('W'), account.alpha],
  )
  expectError(
    () =>
      execute(
        `UPDATE identity_legacy_admin_bootstrap
         SET status = 'consumed', owner_role_assignment_id = NULL, completed_at = NULL,
             revision = 3, write_nonce = ? WHERE legacy_admin_id = 1`,
        [opaque('S')],
      ),
    /state conflict/,
  )
  expectError(
    () => execute('DELETE FROM identity_legacy_admin_bootstrap WHERE legacy_admin_id = 1'),
    /retained/,
  )
  assert.equal(
    database
      .prepare('SELECT status FROM identity_legacy_admin_bootstrap WHERE legacy_admin_id = 1')
      .get().status,
    'completed',
  )
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM identity_role_assignment
         WHERE role = 'platform_owner' AND revoked_at IS NULL`,
      )
      .get().count,
    2,
  )

  console.log('legacy admin bootstrap schema tests passed')
} finally {
  database.close()
}

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'

import { migrationFiles } from './sqlite-fixture.mjs'
import { hash, opaque } from './unified-identity-schema-fixture.mjs'

const database = new DatabaseSync(':memory:')
database.exec('PRAGMA foreign_keys = ON')

try {
  const directory = new URL('../cloudflare/d1/', import.meta.url)
  for (const file of (await migrationFiles()).filter(file => file < '0044_')) {
    database.exec(await readFile(new URL(file, directory), 'utf8'))
  }

  const ownerAccountId = opaque('A')
  const roleId = opaque('R')
  const credentialId = opaque('C')
  database.exec(`
    INSERT INTO admin_account (id, username, password_salt, password_hash)
    VALUES (1, 'legacy-owner', 'legacy-salt', 'legacy-hash');
    INSERT INTO admin_session (token_hash, admin_id, expires_at)
    VALUES ('${hash('a')}', 1, 1000);
  `)
  database
    .prepare(
      `INSERT INTO identity_legacy_admin_bootstrap
      (legacy_admin_id, secret_hash, legacy_session_token_hash, expected_account_id, issued_at, expires_at)
      VALUES (1, ?, ?, ?, 100, 900)`,
    )
    .run(hash('b'), hash('a'), ownerAccountId)
  database
    .prepare(
      `INSERT INTO identity_account
      (id, webauthn_user_handle, display_name, status, verification_state, created_at, updated_at)
      VALUES (?, ?, 'Legacy Owner', 'active', 'legacy_unverified', 150, 150)`,
    )
    .run(ownerAccountId, opaque('U'))
  database
    .prepare(
      `INSERT INTO identity_password_credential
      (id, account_id, username, algorithm, parameters_json, salt, password_hash, pepper_version,
       registration_kind, legacy_admin_bootstrap_id, created_at, updated_at)
      VALUES (?, ?, 'projectowner', 'argon2id', '{"m":65536,"t":3,"p":1}', ?, ?, 1,
       'legacy_admin_bootstrap', 1, 200, 200)`,
    )
    .run(credentialId, ownerAccountId, Buffer.alloc(16, 1), Buffer.alloc(32, 2))
  database
    .prepare(
      `UPDATE identity_legacy_admin_bootstrap
      SET status = 'consumed', consumed_at = 250, consume_nonce = ?, password_credential_id = ?,
          revision = 1, write_nonce = ? WHERE legacy_admin_id = 1`,
    )
    .run(opaque('N'), credentialId, opaque('W'))
  database
    .prepare(
      `INSERT INTO identity_role_assignment
      (id, account_id, role, scope_type, grant_reason, granted_at)
      VALUES (?, ?, 'platform_owner', 'platform', 'Legacy bootstrap owner', 260)`,
    )
    .run(roleId, ownerAccountId)
  database
    .prepare(
      `UPDATE identity_legacy_admin_bootstrap
      SET status = 'completed', owner_role_assignment_id = ?, completed_at = 260,
          revision = 2, write_nonce = ? WHERE legacy_admin_id = 1`,
    )
    .run(roleId, opaque('X'))

  database.exec('BEGIN')
  database.exec(await readFile(new URL('0044_project_manager_role.sql', directory), 'utf8'))
  database.exec('COMMIT')

  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM identity_role_assignment').get().count,
    1,
  )
  assert.equal(
    database
      .prepare('SELECT COUNT(*) AS count FROM identity_role_assignment_before_project_scope')
      .get().count,
    1,
  )
  assert.equal(
    database
      .prepare('PRAGMA foreign_key_list(identity_legacy_admin_bootstrap)')
      .all()
      .find(key => key.from === 'owner_role_assignment_id').table,
    'identity_role_assignment_before_project_scope',
  )
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
  console.log('project manager migration upgrade tests passed')
} finally {
  database.close()
}

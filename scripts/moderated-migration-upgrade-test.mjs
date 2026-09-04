import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'

import { migrationFiles } from './sqlite-fixture.mjs'
import { hash, opaque } from './unified-identity-schema-fixture.mjs'

const migrationsDirectory = new URL('../cloudflare/d1/', import.meta.url)
const database = new DatabaseSync(':memory:')
database.exec('PRAGMA foreign_keys = ON')

try {
  const files = await migrationFiles()
  for (const file of files.filter(file => file < '0015_')) {
    database.exec(await readFile(new URL(file, migrationsDirectory), 'utf8'))
  }

  const accountId = opaque('A')
  const sessionId = opaque('B')
  database
    .prepare(
      `INSERT INTO identity_account
        (id, webauthn_user_handle, display_name, status, verification_state, created_at, updated_at)
       VALUES (?, ?, 'Existing Owner', 'active', 'verified', 100, 100)`,
    )
    .run(accountId, opaque('a'))
  database
    .prepare(
      `INSERT INTO identity_role_assignment
        (id, account_id, role, scope_type, grant_reason, granted_at)
       VALUES (?, ?, 'platform_owner', 'platform', 'Existing deployment owner', 100)`,
    )
    .run(opaque('C'), accountId)
  database
    .prepare(
      `INSERT INTO identity_session
        (id, token_hash, account_id, security_version, auth_method, created_at, last_seen_at,
         idle_expires_at, absolute_expires_at, authenticated_at)
       VALUES (?, ?, ?, 0, 'cas', 100, 100, 900, 1000, 100)`,
    )
    .run(sessionId, hash('1'), accountId)
  database
    .prepare(
      `INSERT INTO identity_auth_intent
        (id, secret_hash, purpose, expected_account_id, passkey_challenge_hash,
         initiating_session_id, redirect_key, flow_id, idempotency_key, created_at, expires_at)
       VALUES (?, ?, 'passkey_step_up', ?, ?, ?, 'account', ?, ?, 200, 400)`,
    )
    .run(opaque('D'), hash('2'), accountId, hash('3'), sessionId, opaque('E'), hash('4'))

  for (const file of files.filter(file => file >= '0015_' && file < '0017_')) {
    database.exec(await readFile(new URL(file, migrationsDirectory), 'utf8'))
  }

  const passwordAccountId = opaque('P')
  const registrationId = opaque('I')
  const credentialId = opaque('Q')
  const passwordSessionId = opaque('L')
  const confirmationId = opaque('M')
  const changeId = opaque('N')
  database
    .prepare(
      `INSERT INTO identity_self_registration
        (id, request_proof_hash, expected_account_id, requested_username,
         requested_display_name, created_at, expires_at)
       VALUES (?, ?, ?, 'upgrade.owner', 'Upgrade Owner', 200, 800)`,
    )
    .run(registrationId, hash('5'), passwordAccountId)
  database
    .prepare(
      `INSERT INTO identity_account
        (id, webauthn_user_handle, display_name, status, verification_state, created_at, updated_at)
       VALUES (?, ?, 'Upgrade Owner', 'active', 'legacy_unverified', 210, 210)`,
    )
    .run(passwordAccountId, opaque('p'))
  database
    .prepare(
      `INSERT INTO identity_password_credential
        (id, account_id, username, algorithm, parameters_json, salt, password_hash,
         pepper_version, registration_kind, self_registration_id, created_at, updated_at)
       VALUES (?, ?, 'upgrade.owner', 'argon2id', '{"m":65536,"t":3,"p":1}', ?, ?,
         1, 'self_registration', ?, 220, 220)`,
    )
    .run(credentialId, passwordAccountId, Buffer.alloc(16, 1), Buffer.alloc(32, 2), registrationId)
  database
    .prepare(
      `UPDATE identity_self_registration
       SET consumed_at = 230, consume_nonce = ?, password_credential_id = ? WHERE id = ?`,
    )
    .run(opaque('S'), credentialId, registrationId)
  database
    .prepare(
      `UPDATE identity_password_credential
       SET last_authenticated_at = 242, updated_at = 242, revision = 1, write_nonce = ?
       WHERE id = ?`,
    )
    .run(opaque('T'), credentialId)
  database
    .prepare(
      `INSERT INTO identity_session
        (id, token_hash, account_id, security_version, auth_method, password_credential_id,
         password_verification_nonce, created_at, last_seen_at, idle_expires_at,
         absolute_expires_at, authenticated_at)
       VALUES (?, ?, ?, 0, 'password', ?, ?, 242, 242, 700, 800, 242)`,
    )
    .run(passwordSessionId, hash('6'), passwordAccountId, credentialId, opaque('T'))
  database
    .prepare(
      `INSERT INTO identity_auth_intent
        (id, secret_hash, purpose, expected_account_id, redirect_key, flow_id,
         idempotency_key, created_at, expires_at)
       VALUES (?, ?, 'sensitive_confirmation', ?, 'account', ?, ?, 241, 700)`,
    )
    .run(confirmationId, hash('7'), passwordAccountId, opaque('U'), hash('8'))
  database
    .prepare(
      `UPDATE identity_auth_intent
       SET consumed_at = 242, consume_nonce = ?, completion_result_type = 'password_credential',
           completion_result_ref = ?, revision = 1, write_nonce = ? WHERE id = ?`,
    )
    .run(opaque('V'), credentialId, opaque('W'), confirmationId)
  database
    .prepare(
      `INSERT INTO identity_password_change_confirmation
        (auth_intent_id, account_id, initiating_session_id, confirmation_method,
         proof_credential_id, confirmed_at)
       VALUES (?, ?, ?, 'password', ?, 242)`,
    )
    .run(confirmationId, passwordAccountId, passwordSessionId, credentialId)
  database
    .prepare(
      `INSERT INTO identity_password_change
        (id, credential_id, account_id, change_kind, authorizing_session_id,
         confirmation_auth_intent_id, from_secret_version, to_secret_version,
         target_security_version, changed_at, request_correlation_id)
       VALUES (?, ?, ?, 'authenticated_change', ?, ?, 1, 2, 1, 243, 'upgrade.password.change')`,
    )
    .run(changeId, credentialId, passwordAccountId, passwordSessionId, confirmationId)
  database
    .prepare(
      `UPDATE identity_password_credential
       SET secret_version = 2, parameters_json = '{"m":65536,"t":4,"p":1}', salt = ?,
           password_hash = ?, pepper_version = 2, last_change_id = ?, updated_at = 243,
           revision = 2, write_nonce = ? WHERE id = ?`,
    )
    .run(Buffer.alloc(16, 3), Buffer.alloc(32, 4), changeId, opaque('X'), credentialId)

  for (const file of files.filter(file => file >= '0017_')) {
    database.exec(await readFile(new URL(file, migrationsDirectory), 'utf8'))
  }

  const migratedSession = database
    .prepare(
      `SELECT auth_method, password_credential_id, password_verification_nonce
       FROM identity_session WHERE id = ?`,
    )
    .get(sessionId)
  assert.equal(migratedSession.auth_method, 'cas')
  assert.equal(migratedSession.password_credential_id, null)
  assert.equal(migratedSession.password_verification_nonce, null)
  assert.equal(
    database
      .prepare('SELECT role FROM identity_role_assignment WHERE account_id = ?')
      .get(accountId).role,
    'platform_owner',
  )
  assert.equal(
    database
      .prepare('SELECT last_change_id FROM identity_password_credential WHERE id = ?')
      .get(credentialId).last_change_id,
    changeId,
  )
  assert.equal(
    database.prepare('SELECT change_kind FROM identity_password_change WHERE id = ?').get(changeId)
      .change_kind,
    'authenticated_change',
  )
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
  const passwordChangeForeignKey = database
    .prepare('PRAGMA foreign_key_list(identity_password_credential)')
    .all()
    .find(key => key.from === 'last_change_id')
  assert.equal(passwordChangeForeignKey.table, 'identity_password_change')
  const initiatingSessionForeignKey = database
    .prepare('PRAGMA foreign_key_list(identity_auth_intent)')
    .all()
    .find(key => key.from === 'initiating_session_id')
  assert.equal(initiatingSessionForeignKey.table, 'identity_session')
  assert.ok(
    database
      .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?")
      .get('identity_membership_status_event'),
  )
  assert.ok(
    database
      .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?")
      .get('identity_membership_review_transfer'),
  )

  console.log('moderated identity migration upgrade tests passed')
} finally {
  database.close()
}

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'

import { migrationFiles } from './sqlite-fixture.mjs'
import { hash, opaque } from './unified-identity-schema-fixture.mjs'

const migrationsDirectory = new URL('../cloudflare/d1/', import.meta.url)
const database = new DatabaseSync(':memory:')
database.exec('PRAGMA foreign_keys = ON')

try {
  for (const file of (await migrationFiles()).filter(file => file < '0015_')) {
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

  database.exec(
    await readFile(new URL('0015_moderated_enrollment.sql', migrationsDirectory), 'utf8'),
  )

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
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
  const initiatingSessionForeignKey = database
    .prepare('PRAGMA foreign_key_list(identity_auth_intent)')
    .all()
    .find(key => key.from === 'initiating_session_id')
  assert.equal(initiatingSessionForeignKey.table, 'identity_session')

  console.log('moderated identity migration upgrade tests passed')
} finally {
  database.close()
}

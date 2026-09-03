import assert from 'node:assert/strict'

import {
  account,
  createUnifiedIdentitySchemaFixture,
  credential,
  hash,
  identity,
  identityKeyHash,
  opaque,
} from './unified-identity-schema-fixture.mjs'

const { database, execute, expectError } = await createUnifiedIdentitySchemaFixture()

try {
  assert.equal(database.prepare('PRAGMA recursive_triggers').get().recursive_triggers, 0)
  const guardedTables = [
    'account',
    'verified_identity',
    'passkey_credential',
    'session',
    'auth_intent',
    'recovery_code_set',
    'recovery_code',
    'auth_attempt_window',
    'auth_attempt_bucket',
    'registration_membership',
    'role_assignment',
    'access_invitation',
    'security_event',
    'notification_outbox',
    'legacy_subject_map',
    'cutover',
  ]
  for (const table of guardedTables) {
    assert.ok(
      database
        .prepare(
          `SELECT 1 FROM sqlite_schema
           WHERE type = 'trigger' AND name = ?`,
        )
        .get(`identity_${table}_insert_conflict_guard`),
    )
  }

  expectError(
    () =>
      execute(
        `INSERT OR REPLACE INTO identity_account
          (id, webauthn_user_handle, display_name, status, verification_state,
           created_at, updated_at)
         VALUES (?, ?, 'Replacement', 'active', 'verified', 100, 100)`,
        [account.alpha, opaque('z')],
      ),
    /insert conflict/,
  )
  expectError(
    () =>
      execute(
        `INSERT OR REPLACE INTO identity_verified_identity
          (id, account_id, adapter_kind, provider, issuer, subject, identity_key_hash,
           display_hint, verified_at)
         VALUES (?, ?, 'oidc', 'replacement', 'https://replacement.example', 'Other', ?,
                 'o***@example', 100)`,
        [
          identity.alpha,
          account.bravo,
          identityKeyHash('replacement', 'https://replacement.example', 'Other'),
        ],
      ),
    /insert conflict/,
  )
  expectError(
    () =>
      execute(
        `INSERT OR REPLACE INTO identity_passkey_credential
          (credential_id, account_id, registration_kind, public_key, device_type, created_at)
         VALUES (?, ?, 'legacy_migration', ?, 'singleDevice', 100)`,
        [credential.alpha, account.bravo, Buffer.from('replacement-key')],
      ),
    /insert conflict/,
  )
  expectError(
    () =>
      execute(
        `INSERT OR REPLACE INTO identity_session
          (id, token_hash, account_id, security_version, auth_method, created_at, last_seen_at,
           idle_expires_at, absolute_expires_at, authenticated_at)
         VALUES (?, ?, ?, 0, 'oidc', 100, 100, 1000, 2000, 100)`,
        [opaque('Y'), hash('9'), account.alpha],
      ),
    /insert conflict/,
  )

  const intentId = opaque('i')
  execute(
    `INSERT INTO identity_auth_intent
      (id, secret_hash, purpose, redirect_key, flow_id, idempotency_key, created_at, expires_at)
     VALUES (?, ?, 'sign_in', 'account', ?, ?, 100, 1000)`,
    [intentId, hash('1'), opaque('j'), hash('2')],
  )
  expectError(
    () =>
      execute(
        `INSERT OR REPLACE INTO identity_auth_intent
          (id, secret_hash, purpose, redirect_key, flow_id, idempotency_key,
           created_at, expires_at)
         VALUES (?, ?, 'sign_in', 'account', ?, ?, 100, 1000)`,
        [intentId, hash('3'), opaque('k'), hash('4')],
      ),
    /insert conflict/,
  )

  console.log('unified identity replace guard schema tests passed')
} finally {
  database.close()
}

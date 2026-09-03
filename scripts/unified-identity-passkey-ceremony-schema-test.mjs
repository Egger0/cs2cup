import assert from 'node:assert/strict'

import {
  account,
  createUnifiedIdentitySchemaFixture,
  credential,
  hash,
  opaque,
} from './unified-identity-schema-fixture.mjs'

const { database, execute, expectError } = await createUnifiedIdentitySchemaFixture()

try {
  expectError(() =>
    execute(
      `INSERT INTO identity_auth_intent
        (id, secret_hash, purpose, expected_account_id, redirect_key, flow_id, idempotency_key,
         created_at, expires_at)
       VALUES (?, ?, 'passkey_enrollment', ?, 'account', ?, ?, 100, 400)`,
      [opaque('1'), hash('1'), account.alpha, opaque('2'), hash('2')],
    ),
  )

  const enrollmentIntentId = opaque('3')
  execute(
    `INSERT INTO identity_auth_intent
      (id, secret_hash, purpose, expected_account_id, passkey_challenge_hash, redirect_key,
       flow_id, idempotency_key, created_at, expires_at)
     VALUES (?, ?, 'passkey_enrollment', ?, ?, 'account', ?, ?, 100, 400)`,
    [enrollmentIntentId, hash('3'), account.alpha, hash('4'), opaque('4'), hash('5')],
  )
  const initiatingSessionId = opaque('7')
  execute(
    `INSERT INTO identity_session
      (id, token_hash, account_id, security_version, auth_method, created_at, last_seen_at,
       idle_expires_at, absolute_expires_at, authenticated_at)
     VALUES (?, ?, ?, 0, 'oidc', 100, 100, 1000, 2000, 100)`,
    [initiatingSessionId, hash('7'), account.alpha],
  )
  execute(
    `INSERT INTO identity_passkey_enrollment_authorization
      (auth_intent_id, account_id, initiating_session_id, authorized_at)
     VALUES (?, ?, ?, 150)`,
    [enrollmentIntentId, account.alpha, initiatingSessionId],
  )
  expectError(
    () =>
      execute(
        `INSERT INTO identity_passkey_credential
          (credential_id, account_id, registration_kind, registration_auth_intent_id,
           public_key, device_type, created_at)
         VALUES ('wrong_account_credential', ?, 'ceremony', ?, ?, 'singleDevice', 200)`,
        [account.bravo, enrollmentIntentId, Buffer.from('wrong-account-key')],
      ),
    /signed-in authorization/,
  )
  const enrolledCredentialId = 'credential_enrolled'
  execute(
    `INSERT INTO identity_passkey_credential
      (credential_id, account_id, registration_kind, registration_auth_intent_id,
       public_key, device_type, created_at)
     VALUES (?, ?, 'ceremony', ?, ?, 'multiDevice', 200)`,
    [enrolledCredentialId, account.alpha, enrollmentIntentId, Buffer.from('enrolled-key')],
  )
  expectError(
    () =>
      execute(
        `UPDATE identity_auth_intent
         SET consumed_at = 200, consume_nonce = ?, completion_result_type = 'passkey_credential',
             completion_result_ref = ?, revision = 1, write_nonce = ? WHERE id = ?`,
        [opaque('5'), credential.alpha, opaque('6'), enrollmentIntentId],
      ),
    /credential mismatch/,
  )
  execute(
    `UPDATE identity_auth_intent
     SET consumed_at = 200, consume_nonce = ?, completion_result_type = 'passkey_credential',
         completion_result_ref = ?, revision = 1, write_nonce = ? WHERE id = ?`,
    [opaque('5'), enrolledCredentialId, opaque('6'), enrollmentIntentId],
  )

  expectError(
    () =>
      execute(
        `INSERT INTO identity_auth_intent
          (id, secret_hash, purpose, expected_account_id, passkey_challenge_hash, redirect_key,
           flow_id, idempotency_key, created_at, expires_at)
         VALUES (?, ?, 'passkey_step_up', ?, ?, 'account', ?, ?, 150, 450)`,
        [opaque('8'), hash('8'), account.alpha, hash('9'), opaque('9'), hash('a')],
      ),
    /current account session/,
  )

  const stepUpIntentId = opaque('a')
  execute(
    `INSERT INTO identity_auth_intent
      (id, secret_hash, purpose, expected_account_id, passkey_challenge_hash,
       initiating_session_id, redirect_key, flow_id, idempotency_key, created_at, expires_at)
     VALUES (?, ?, 'passkey_step_up', ?, ?, ?, 'account', ?, ?, 150, 450)`,
    [
      stepUpIntentId,
      hash('b'),
      account.alpha,
      hash('c'),
      initiatingSessionId,
      opaque('b'),
      hash('d'),
    ],
  )
  execute(
    `UPDATE identity_auth_intent
     SET consumed_at = 200, consume_nonce = ?, completion_result_type = 'passkey_credential',
         completion_result_ref = ?, revision = 1, write_nonce = ? WHERE id = ?`,
    [opaque('c'), credential.alpha, opaque('d'), stepUpIntentId],
  )
  execute(
    `INSERT INTO identity_session
      (id, token_hash, account_id, security_version, auth_method, authenticator_credential_id,
       passkey_auth_intent_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at,
       authenticated_at, phishing_resistant_at)
     VALUES (?, ?, ?, 0, 'passkey', ?, ?, 200, 200, 1000, 2000, 200, 200)`,
    [opaque('e'), hash('e'), account.alpha, credential.alpha, stepUpIntentId],
  )

  assert.deepEqual(
    database
      .prepare(
        `SELECT purpose FROM identity_auth_intent
         WHERE purpose LIKE 'passkey_%' ORDER BY purpose`,
      )
      .all()
      .map(row => row.purpose),
    ['passkey_enrollment', 'passkey_step_up'],
  )
  console.log('unified identity passkey ceremony schema tests passed')
} finally {
  database.close()
}

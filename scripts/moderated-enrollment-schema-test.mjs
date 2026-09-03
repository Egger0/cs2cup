import assert from 'node:assert/strict'

import {
  createModeratedIdentityFixture,
  hash,
  moderated,
  opaque,
} from './moderated-identity-schema-fixture.mjs'

const {
  database,
  execute,
  expectError,
  insertSelfRegistration,
  createActiveAccount,
  createPasswordCredential,
  consumeSelfRegistration,
} = await createModeratedIdentityFixture()

try {
  expectError(
    () =>
      insertSelfRegistration({
        id: opaque('a'),
        requestProofHash: hash('a'),
        username: 'player-',
      }),
    /CHECK/,
  )
  expectError(
    () =>
      insertSelfRegistration({
        id: opaque('b'),
        requestProofHash: hash('b'),
        username: 'root',
      }),
    /CHECK/,
  )
  insertSelfRegistration()
  expectError(() => createActiveAccount({ displayName: 'Different Player' }), /provenance/)
  createActiveAccount()
  expectError(() => createPasswordCredential({ username: 'other.player' }), /provenance/)
  createPasswordCredential()
  expectError(
    () =>
      execute(
        `UPDATE identity_self_registration
         SET consumed_at = 180, consume_nonce = ?, password_credential_id = ? WHERE id = ?`,
        [opaque('c'), opaque('d'), moderated.registrationId],
      ),
    /password proof mismatch/,
  )
  consumeSelfRegistration()

  const account = database
    .prepare('SELECT status, verification_state FROM identity_account WHERE id = ?')
    .get(moderated.accountId)
  assert.equal(account.status, 'active')
  assert.equal(account.verification_state, 'legacy_unverified')
  assert.equal(
    database
      .prepare('SELECT COUNT(*) AS count FROM identity_membership WHERE account_id = ?')
      .get(moderated.accountId).count,
    0,
  )
  expectError(
    () =>
      execute(
        `UPDATE identity_self_registration
         SET consumed_at = 181, consume_nonce = ?, password_credential_id = ? WHERE id = ?`,
        [opaque('e'), moderated.credentialId, moderated.registrationId],
      ),
    /consumption conflict/,
  )

  const verificationNonce = opaque('W')
  execute(
    `UPDATE identity_password_credential
     SET last_authenticated_at = 200, updated_at = 200, revision = 1, write_nonce = ?
     WHERE id = ?`,
    [verificationNonce, moderated.credentialId],
  )
  const sessionId = opaque('X')
  const sessionInsert = `INSERT INTO identity_session
    (id, token_hash, account_id, security_version, auth_method, password_credential_id,
     password_verification_nonce, created_at, last_seen_at, idle_expires_at,
     absolute_expires_at, authenticated_at)
   VALUES (?, ?, ?, 0, 'password', ?, ?, 200, 200, 700, 800, 200)`
  execute(sessionInsert, [
    sessionId,
    hash('4'),
    moderated.accountId,
    moderated.credentialId,
    verificationNonce,
  ])
  expectError(
    () =>
      execute(sessionInsert, [
        opaque('f'),
        hash('5'),
        moderated.accountId,
        moderated.credentialId,
        verificationNonce,
      ]),
    /(?:insert conflict|UNIQUE)/,
  )

  const passkeyIntentId = opaque('Z')
  execute(
    `INSERT INTO identity_auth_intent
      (id, secret_hash, purpose, expected_account_id, passkey_challenge_hash, redirect_key,
       flow_id, idempotency_key, created_at, expires_at)
     VALUES (?, ?, 'passkey_enrollment', ?, ?, 'account', ?, ?, 210, 700)`,
    [passkeyIntentId, hash('6'), moderated.accountId, hash('7'), opaque('0'), hash('8')],
  )
  const passkeyInsert = `INSERT INTO identity_passkey_credential
    (credential_id, account_id, registration_kind, registration_auth_intent_id,
     public_key, device_type, created_at)
   VALUES ('optional_passkey', ?, 'ceremony', ?, ?, 'multiDevice', 220)`
  expectError(
    () =>
      execute(passkeyInsert, [
        moderated.accountId,
        passkeyIntentId,
        Buffer.from('optional-passkey'),
      ]),
    /signed-in authorization/,
  )
  execute(
    `INSERT INTO identity_passkey_enrollment_authorization
      (auth_intent_id, account_id, initiating_session_id, authorized_at)
     VALUES (?, ?, ?, 210)`,
    [passkeyIntentId, moderated.accountId, sessionId],
  )
  execute(passkeyInsert, [moderated.accountId, passkeyIntentId, Buffer.from('optional-passkey')])
  assert.equal(
    database
      .prepare('SELECT COUNT(*) AS count FROM identity_passkey_credential WHERE account_id = ?')
      .get(moderated.accountId).count,
    1,
  )

  console.log('self-service account schema tests passed')
} finally {
  database.close()
}

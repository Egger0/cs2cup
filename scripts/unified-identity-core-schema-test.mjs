import assert from 'node:assert/strict'

import {
  account,
  assertUnifiedIdentityBootstrapInvariants,
  createUnifiedIdentitySchemaFixture,
  credential,
  hash,
  identity,
  opaque,
} from './unified-identity-schema-fixture.mjs'

const { database, execute, expectError, insertAccount, insertIdentity } =
  await createUnifiedIdentitySchemaFixture()

try {
  assertUnifiedIdentityBootstrapInvariants({ expectError, insertAccount, insertIdentity })
  expectError(
    () =>
      execute(
        `UPDATE identity_verified_identity
         SET identity_key_hash = ?, revision = 1, write_nonce = ? WHERE id = ?`,
        [hash('f'), opaque('v'), identity.alpha],
      ),
    /verified identity revision conflict/,
  )
  expectError(
    () =>
      execute(
        `INSERT INTO identity_account
          (id, webauthn_user_handle, display_name, status, verification_state, security_version,
           locked_at, created_at, updated_at)
         VALUES (?, ?, 'Invalid Fresh State', 'locked', 'verified', 1, 100, 100, 100)`,
        [opaque('z'), opaque('6')],
      ),
    /must start fresh/,
  )

  expectError(() =>
    execute(
      `INSERT INTO identity_passkey_credential
        (credential_id, account_id, registration_kind, public_key, device_type, created_at)
       VALUES ('not-blob', ?, 'legacy_migration', 'text-key', 'multiDevice', 100)`,
      [account.alpha],
    ),
  )
  expectError(() =>
    execute('UPDATE identity_passkey_credential SET counter = 1 WHERE credential_id = ?', [
      credential.alpha,
    ]),
  )
  execute(
    `UPDATE identity_passkey_credential
     SET counter = 1, last_used_at = 200, revision = 1, write_nonce = ?
     WHERE credential_id = ?`,
    [opaque('n'), credential.alpha],
  )
  expectError(() =>
    execute(
      `UPDATE identity_passkey_credential
       SET counter = 0, last_used_at = 300, revision = 2, write_nonce = ?
       WHERE credential_id = ?`,
      [opaque('o'), credential.alpha],
    ),
  )

  const passkeyIntentId = opaque('P')
  execute(
    `INSERT INTO identity_auth_intent
      (id, secret_hash, purpose, passkey_challenge_hash, redirect_key, flow_id,
       idempotency_key, created_at, expires_at)
     VALUES (?, ?, 'passkey_sign_in', ?, 'account', ?, ?, 100, 400)`,
    [passkeyIntentId, hash('9'), hash('a'), opaque('k'), hash('b')],
  )
  execute(
    `UPDATE identity_auth_intent
     SET consumed_at = 100, consume_nonce = ?, completion_result_type = 'passkey_credential',
         completion_result_ref = ?, revision = 1, write_nonce = ? WHERE id = ?`,
    [opaque('l'), credential.alpha, opaque('m'), passkeyIntentId],
  )
  expectError(
    () =>
      execute(
        `INSERT INTO identity_session
          (id, token_hash, account_id, security_version, auth_method, authenticator_credential_id,
           passkey_auth_intent_id, created_at, last_seen_at, idle_expires_at,
           absolute_expires_at, authenticated_at, phishing_resistant_at)
         VALUES (?, ?, ?, 0, 'passkey', ?, ?, 100, 100, 1000, 2000, 100, 100)`,
        [opaque('T'), hash('2'), account.bravo, credential.alpha, passkeyIntentId],
      ),
    /consumed passkey ceremony/,
  )
  execute(
    `INSERT INTO identity_session
      (id, token_hash, account_id, security_version, auth_method, authenticator_credential_id,
       passkey_auth_intent_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at,
       authenticated_at, phishing_resistant_at)
     VALUES (?, ?, ?, 0, 'passkey', ?, ?, 100, 100, 1000, 2000, 100, 100)`,
    [opaque('S'), hash('1'), account.alpha, credential.alpha, passkeyIntentId],
  )
  expectError(
    () =>
      execute(
        `INSERT INTO identity_session
          (id, token_hash, account_id, security_version, auth_method, created_at, last_seen_at,
           idle_expires_at, absolute_expires_at, authenticated_at)
         VALUES (?, ?, ?, 9, 'oidc', 100, 100, 1000, 2000, 100)`,
        [opaque('U'), hash('3'), account.alpha],
      ),
    /security version mismatch/,
  )
  expectError(() =>
    execute(
      `INSERT INTO identity_session
        (id, token_hash, account_id, security_version, auth_method, created_at, last_seen_at,
         idle_expires_at, absolute_expires_at, authenticated_at, phishing_resistant_at)
       VALUES (?, ?, ?, 0, 'oidc', 100, 100, 1000, 2000, 100, 100)`,
      [opaque('G'), hash('d'), account.alpha],
    ),
  )
  execute(
    `INSERT INTO identity_session
      (id, token_hash, account_id, security_version, auth_method, created_at, last_seen_at,
       idle_expires_at, absolute_expires_at, authenticated_at)
     VALUES (?, ?, ?, 0, 'oidc', 100, 100, 2000, 2000, 100)`,
    [opaque('G'), hash('d'), account.bravo],
  )

  expectError(() =>
    execute(
      `UPDATE identity_account
       SET status = 'locked', locked_at = 200, updated_at = 200, revision = 1,
           write_nonce = ? WHERE id = ?`,
      [opaque('k'), account.charlie],
    ),
  )
  execute(
    `UPDATE identity_account
     SET status = 'locked', locked_at = 200, security_version = 1, updated_at = 200,
         revision = 1, write_nonce = ? WHERE id = ?`,
    [opaque('k'), account.charlie],
  )
  expectError(
    () =>
      execute(
        `INSERT INTO identity_session
          (id, token_hash, account_id, security_version, auth_method, created_at, last_seen_at,
           idle_expires_at, absolute_expires_at, authenticated_at)
         VALUES (?, ?, ?, 1, 'cas', 200, 200, 1000, 2000, 200)`,
        [opaque('J'), hash('c'), account.charlie],
      ),
    /account state or security version mismatch/,
  )
  execute(
    `UPDATE identity_account
     SET status = 'active', locked_at = NULL, updated_at = 300, revision = 2,
         write_nonce = ? WHERE id = ?`,
    [opaque('l'), account.charlie],
  )
  assert.equal(
    database
      .prepare('SELECT security_version FROM identity_account WHERE id = ?')
      .get(account.charlie).security_version,
    1,
  )
  expectError(
    () =>
      execute(
        `UPDATE identity_account
         SET status = 'pending', updated_at = 400, revision = 3, write_nonce = ? WHERE id = ?`,
        [opaque('m'), account.charlie],
      ),
    /revision conflict/,
  )
  expectError(
    () =>
      execute(
        `UPDATE identity_account
         SET verification_state = 'legacy_unverified', updated_at = 400, revision = 3,
             write_nonce = ? WHERE id = ?`,
        [opaque('m'), account.charlie],
      ),
    /revision conflict/,
  )

  const intentInsert = `INSERT INTO identity_auth_intent
    (id, secret_hash, purpose, expected_account_id, verified_identity_id, redirect_key, flow_id,
     idempotency_key, created_at, expires_at)
   VALUES (?, ?, ?, ?, ?, 'account', ?, ?, 100, 1000)`
  execute(intentInsert, [
    opaque('I'),
    hash('4'),
    'recovery',
    account.alpha,
    identity.alpha,
    opaque('f'),
    hash('5'),
  ])
  expectError(() =>
    execute(intentInsert, [
      opaque('J'),
      hash('6'),
      'recovery',
      account.bravo,
      identity.bravo,
      opaque('g'),
      hash('5'),
    ]),
  )
  expectError(
    () =>
      execute(intentInsert, [
        opaque('K'),
        hash('7'),
        'identity_link',
        account.bravo,
        identity.alpha,
        opaque('h'),
        hash('8'),
      ]),
    /account mismatch/,
  )
  execute(
    `UPDATE identity_auth_intent
     SET consumed_at = 200, consume_nonce = ?, completion_result_type = 'verified_identity',
         completion_result_ref = ?, revision = 1, write_nonce = ? WHERE id = ?`,
    [opaque('q'), identity.alpha, opaque('r'), opaque('I')],
  )
  expectError(() =>
    execute('UPDATE identity_auth_intent SET revision = 2, write_nonce = ? WHERE id = ?', [
      opaque('s'),
      opaque('I'),
    ]),
  )

  console.log('unified identity core schema tests passed')
} finally {
  database.close()
}

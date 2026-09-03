import {
  account,
  createUnifiedIdentitySchemaFixture,
  hash,
  identity,
  opaque,
} from './unified-identity-schema-fixture.mjs'

const { database, execute, expectError } = await createUnifiedIdentitySchemaFixture()

try {
  const insertRecoveryIntent = (id, verifiedIdentityId, secret, flow, idempotency) =>
    execute(
      `INSERT INTO identity_auth_intent
        (id, secret_hash, purpose, expected_account_id, verified_identity_id, redirect_key,
         flow_id, idempotency_key, created_at, expires_at)
       VALUES (?, ?, 'recovery', ?, ?, 'account', ?, ?, 100, 1000)`,
      [id, secret, account.alpha, verifiedIdentityId, flow, idempotency],
    )
  const completeIdentityRecovery = (id, resultIdentity, nonce, writeNonce) =>
    execute(
      `UPDATE identity_auth_intent
       SET consumed_at = 200, consume_nonce = ?, completion_result_type = 'verified_identity',
           completion_result_ref = ?, revision = 1, write_nonce = ? WHERE id = ?`,
      [nonce, resultIdentity, writeNonce, id],
    )

  const oidcRecoveryIntentId = opaque('l')
  insertRecoveryIntent(oidcRecoveryIntentId, identity.alpha, hash('5'), opaque('m'), hash('6'))
  expectError(
    () => completeIdentityRecovery(oidcRecoveryIntentId, identity.bravo, opaque('n'), opaque('o')),
    /proof mismatch/,
  )
  completeIdentityRecovery(oidcRecoveryIntentId, identity.alpha, opaque('n'), opaque('o'))
  execute(
    `INSERT INTO identity_session
      (id, token_hash, account_id, security_version, auth_method, recovery_auth_intent_id,
       created_at, last_seen_at, idle_expires_at, absolute_expires_at, authenticated_at,
       recovery_verified_at, recovery_restricted)
     VALUES (?, ?, ?, 0, 'oidc', ?, 200, 200, 1000, 2000, 200, 200, 1)`,
    [opaque('p'), hash('7'), account.alpha, oidcRecoveryIntentId],
  )
  expectError(
    () =>
      execute(
        `INSERT INTO identity_session
          (id, token_hash, account_id, security_version, auth_method, recovery_auth_intent_id,
           created_at, last_seen_at, idle_expires_at, absolute_expires_at, authenticated_at,
           recovery_verified_at, recovery_restricted)
         VALUES (?, ?, ?, 0, 'oidc', ?, 200, 200, 1000, 2000, 200, 200, 1)`,
        [opaque('q'), hash('8'), account.alpha, oidcRecoveryIntentId],
      ),
    /(?:UNIQUE|insert conflict)/,
  )

  const wrongMethodIntentId = opaque('r')
  insertRecoveryIntent(wrongMethodIntentId, identity.alpha, hash('9'), opaque('s'), hash('a'))
  completeIdentityRecovery(wrongMethodIntentId, identity.alpha, opaque('t'), opaque('u'))
  expectError(
    () =>
      execute(
        `INSERT INTO identity_session
          (id, token_hash, account_id, security_version, auth_method, recovery_auth_intent_id,
           created_at, last_seen_at, idle_expires_at, absolute_expires_at, authenticated_at,
           recovery_verified_at, recovery_restricted)
         VALUES (?, ?, ?, 0, 'cas', ?, 200, 200, 1000, 2000, 200, 200, 1)`,
        [opaque('v'), hash('b'), account.alpha, wrongMethodIntentId],
      ),
    /consumed recovery intent/,
  )

  console.log('unified identity recovery context schema tests passed')
} finally {
  database.close()
}

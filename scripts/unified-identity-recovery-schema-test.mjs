import assert from 'node:assert/strict'

import {
  account,
  createUnifiedIdentitySchemaFixture,
  hash,
  opaque,
} from './unified-identity-schema-fixture.mjs'

const { database, execute, expectError } = await createUnifiedIdentitySchemaFixture()

try {
  expectError(
    () =>
      execute(
        `INSERT INTO identity_session
          (id, token_hash, account_id, security_version, auth_method, created_at, last_seen_at,
           idle_expires_at, absolute_expires_at, authenticated_at, recovery_verified_at,
           recovery_restricted)
         VALUES (?, ?, ?, 0, 'assisted_recovery', 100, 100, 1000, 2000, 100, 100, 1)`,
        [opaque('Q'), hash('f'), account.alpha],
      ),
    /not enabled/,
  )
  const recoveryCodeSetId = opaque('R')
  const recoveryCodeIds = ['a', 'b', 'c', 'd', 'e', 'f'].map(opaque)
  execute(
    `INSERT INTO identity_recovery_code_set
      (id, account_id, verifier_key_version, code_count, created_at)
     VALUES (?, ?, 1, 6, 100)`,
    [recoveryCodeSetId, account.alpha],
  )
  expectError(
    () =>
      execute(
        `INSERT INTO identity_recovery_code_set
          (id, account_id, verifier_key_version, code_count, created_at)
         VALUES (?, ?, 1, 6, 101)`,
        [opaque('q'), account.alpha],
      ),
    /(?:UNIQUE|insert conflict)/,
  )
  execute(
    `INSERT INTO identity_recovery_code_set
      (id, account_id, verifier_key_version, code_count, created_at)
     VALUES (?, ?, 1, 6, 100)`,
    [opaque('u'), account.bravo],
  )
  execute(
    `UPDATE identity_recovery_code_set
     SET status = 'revoked', closed_at = 101, revision = 1, write_nonce = ? WHERE id = ?`,
    [opaque('v'), opaque('u')],
  )
  execute(
    `INSERT INTO identity_recovery_code_set
      (id, account_id, verifier_key_version, code_count, created_at)
     VALUES (?, ?, 1, 6, 102)`,
    [opaque('w'), account.bravo],
  )
  execute(
    `UPDATE identity_recovery_code_set
     SET status = 'revoked', closed_at = 103, revision = 1, write_nonce = ? WHERE id = ?`,
    [opaque('x'), opaque('w')],
  )
  for (let ordinal = 0; ordinal < 5; ordinal += 1) {
    execute(
      `INSERT INTO identity_recovery_code
        (id, set_id, ordinal, verifier, created_at)
       VALUES (?, ?, ?, ?, 100)`,
      [recoveryCodeIds[ordinal], recoveryCodeSetId, ordinal, hash(String(ordinal))],
    )
  }
  expectError(
    () =>
      execute(
        `UPDATE identity_recovery_code_set
         SET status = 'active', activated_at = 150, revision = 1, write_nonce = ?
         WHERE id = ?`,
        [opaque('G'), recoveryCodeSetId],
      ),
    /incomplete/,
  )
  execute(
    `INSERT INTO identity_recovery_code
      (id, set_id, ordinal, verifier, created_at)
     VALUES (?, ?, 5, ?, 100)`,
    [recoveryCodeIds[5], recoveryCodeSetId, hash('5')],
  )
  execute(
    `UPDATE identity_recovery_code_set
     SET status = 'active', activated_at = 150, revision = 1, write_nonce = ?
     WHERE id = ?`,
    [opaque('G'), recoveryCodeSetId],
  )
  expectError(
    () =>
      execute(
        `INSERT INTO identity_recovery_code
          (id, set_id, ordinal, verifier, created_at)
         VALUES (?, ?, 6, ?, 100)`,
        [opaque('g'), recoveryCodeSetId, hash('6')],
      ),
    /building set/,
  )

  const validRecoveryIntentId = opaque('r')
  const wrongRecoveryIntentId = opaque('s')
  const recoveryIntentInsert = `INSERT INTO identity_auth_intent
    (id, secret_hash, purpose, expected_account_id, redirect_key, flow_id, idempotency_key,
     created_at, expires_at)
   VALUES (?, ?, 'recovery', ?, 'account', ?, ?, 100, 1000)`
  execute(recoveryIntentInsert, [
    validRecoveryIntentId,
    hash('a'),
    account.alpha,
    opaque('A'),
    hash('b'),
  ])
  execute(recoveryIntentInsert, [
    wrongRecoveryIntentId,
    hash('b'),
    account.bravo,
    opaque('B'),
    hash('c'),
  ])
  const consumeRecoveryCode = (codeId, intentId, consumeNonce, writeNonce) =>
    execute(
      `UPDATE identity_recovery_code
       SET consumed_at = 200, consumed_auth_intent_id = ?, consume_nonce = ?, revision = 1,
           write_nonce = ? WHERE id = ?`,
      [intentId, consumeNonce, writeNonce, codeId],
    )
  expectError(
    () => consumeRecoveryCode(recoveryCodeIds[0], wrongRecoveryIntentId, opaque('E'), opaque('F')),
    /consumption conflict/,
  )

  database.exec('BEGIN IMMEDIATE')
  expectError(() => {
    consumeRecoveryCode(recoveryCodeIds[0], validRecoveryIntentId, opaque('E'), opaque('F'))
    consumeRecoveryCode(recoveryCodeIds[1], validRecoveryIntentId, opaque('H'), opaque('I'))
  }, /UNIQUE/)
  database.exec('ROLLBACK')
  assert.equal(
    database
      .prepare('SELECT consumed_at FROM identity_recovery_code WHERE id = ?')
      .get(recoveryCodeIds[0]).consumed_at,
    null,
  )

  database.exec('BEGIN IMMEDIATE')
  consumeRecoveryCode(recoveryCodeIds[0], validRecoveryIntentId, opaque('E'), opaque('F'))
  execute(
    `UPDATE identity_auth_intent
     SET consumed_at = 200, consume_nonce = ?, completion_result_type = 'recovery_code',
         completion_result_ref = ?, revision = 1, write_nonce = ? WHERE id = ?`,
    [opaque('D'), recoveryCodeIds[0], opaque('C'), validRecoveryIntentId],
  )
  execute(
    `INSERT INTO identity_session
      (id, token_hash, account_id, security_version, auth_method, recovery_code_id,
       recovery_auth_intent_id, created_at, last_seen_at, idle_expires_at,
       absolute_expires_at, authenticated_at, recovery_verified_at, recovery_restricted)
     VALUES (?, ?, ?, 0, 'recovery_code', ?, ?, 200, 200, 1000, 2000, 200, 200, 1)`,
    [opaque('F'), hash('e'), account.alpha, recoveryCodeIds[0], validRecoveryIntentId],
  )
  database.exec('COMMIT')

  expectError(() =>
    execute(
      `INSERT INTO identity_session
        (id, token_hash, account_id, security_version, auth_method, recovery_code_id,
         recovery_auth_intent_id, created_at, last_seen_at, idle_expires_at,
         absolute_expires_at, authenticated_at,
         recovery_verified_at, recovery_restricted)
       VALUES (?, ?, ?, 0, 'recovery_code', ?, ?, 200, 200, 1000, 2000, 200, 200, 0)`,
      [opaque('j'), hash('f'), account.alpha, recoveryCodeIds[0], validRecoveryIntentId],
    ),
  )
  expectError(
    () => consumeRecoveryCode(recoveryCodeIds[0], validRecoveryIntentId, opaque('H'), opaque('I')),
    /consumption conflict/,
  )
  expectError(
    () =>
      execute(
        `UPDATE identity_session
         SET auth_method = 'oidc', recovery_code_id = NULL, recovery_auth_intent_id = NULL,
             recovery_verified_at = NULL, recovery_restricted = 0, revision = 1,
             write_nonce = ? WHERE id = ?`,
        [opaque('i'), opaque('F')],
      ),
    /revision conflict/,
  )

  const replacementSetId = opaque('Z')
  const replacementCodeIds = ['A', 'B', 'C', 'D', 'E', 'F'].map(opaque)
  execute(
    `INSERT INTO identity_recovery_code_set
      (id, account_id, verifier_key_version, code_count, created_at)
     VALUES (?, ?, 1, 6, 300)`,
    [replacementSetId, account.alpha],
  )
  for (let ordinal = 0; ordinal < 6; ordinal += 1) {
    execute(
      `INSERT INTO identity_recovery_code
        (id, set_id, ordinal, verifier, created_at)
       VALUES (?, ?, ?, ?, 300)`,
      [
        replacementCodeIds[ordinal],
        replacementSetId,
        ordinal,
        hash(String.fromCharCode('a'.charCodeAt(0) + ordinal)),
      ],
    )
  }
  expectError(
    () =>
      execute(
        `UPDATE identity_recovery_code_set
         SET status = 'active', activated_at = 350, revision = 1, write_nonce = ?
         WHERE id = ?`,
        [opaque('I'), replacementSetId],
      ),
    /(?:UNIQUE|insert conflict)/,
  )
  execute(
    `UPDATE identity_recovery_code_set
     SET status = 'replaced', closed_at = 350, revision = 2, write_nonce = ?
     WHERE id = ?`,
    [opaque('H'), recoveryCodeSetId],
  )
  execute(
    `UPDATE identity_recovery_code_set
     SET status = 'active', activated_at = 350, revision = 1, write_nonce = ?
     WHERE id = ?`,
    [opaque('I'), replacementSetId],
  )
  const replacedSetIntentId = opaque('t')
  execute(recoveryIntentInsert, [
    replacedSetIntentId,
    hash('d'),
    account.alpha,
    opaque('C'),
    hash('e'),
  ])
  expectError(
    () =>
      execute(
        `UPDATE identity_recovery_code
         SET consumed_at = 400, consumed_auth_intent_id = ?, consume_nonce = ?, revision = 1,
             write_nonce = ? WHERE id = ?`,
        [replacedSetIntentId, opaque('J'), opaque('K'), recoveryCodeIds[1]],
      ),
    /consumption conflict/,
  )
  expectError(
    () => execute('DELETE FROM identity_recovery_code WHERE id = ?', [recoveryCodeIds[0]]),
    /retained/,
  )
  expectError(
    () => execute('DELETE FROM identity_recovery_code_set WHERE id = ?', [recoveryCodeSetId]),
    /retained/,
  )

  console.log('unified identity recovery schema tests passed')
} finally {
  database.close()
}

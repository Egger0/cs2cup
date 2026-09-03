import assert from 'node:assert/strict'

import {
  createModeratedIdentityFixture,
  hash,
  moderated,
  opaque,
} from './moderated-identity-schema-fixture.mjs'

const { database, execute, expectError, registerPasswordAccount } =
  await createModeratedIdentityFixture()

try {
  registerPasswordAccount()

  const passwordColumns = new Set(
    database
      .prepare('PRAGMA table_info(identity_password_credential)')
      .all()
      .map(column => column.name),
  )
  assert.equal(passwordColumns.has('password'), false)
  assert.equal(passwordColumns.has('password_plaintext'), false)
  assert.equal(passwordColumns.has('password_hash'), true)

  expectError(
    () =>
      execute(
        `UPDATE identity_password_credential
         SET algorithm = 'sha256', revision = 1, write_nonce = ? WHERE id = ?`,
        [opaque('a'), moderated.credentialId],
      ),
    /(?:CHECK|revision conflict)/,
  )
  execute(
    `UPDATE identity_password_credential
     SET failed_attempt_count = 1, last_failed_at = 380, locked_until = 390,
         updated_at = 380, revision = 1, write_nonce = ?
     WHERE id = ?`,
    [opaque('b'), moderated.credentialId],
  )
  expectError(
    () =>
      execute(
        `INSERT INTO identity_session
          (id, token_hash, account_id, security_version, auth_method, password_credential_id,
           password_verification_nonce, created_at, last_seen_at, idle_expires_at,
           absolute_expires_at, authenticated_at)
         VALUES (?, ?, ?, 0, 'password', ?, ?, 395, 395, 700, 800, 395)`,
        [opaque('c'), hash('8'), moderated.accountId, moderated.credentialId, opaque('b')],
      ),
    /verified password credential/,
  )
  const lostCas = execute(
    `UPDATE identity_password_credential
     SET last_authenticated_at = 399, failed_attempt_count = 0, last_failed_at = NULL,
         locked_until = NULL, updated_at = 399, revision = 2, write_nonce = ?
     WHERE id = ? AND write_nonce = ?`,
    [opaque('t'), moderated.credentialId, opaque('u')],
  )
  assert.equal(lostCas.changes, 0)
  expectError(
    () =>
      execute(
        `INSERT INTO identity_session
          (id, token_hash, account_id, security_version, auth_method, password_credential_id,
           password_verification_nonce, created_at, last_seen_at, idle_expires_at,
           absolute_expires_at, authenticated_at)
         VALUES (?, ?, ?, 0, 'password', ?, ?, 399, 399, 700, 800, 399)`,
        [opaque('v'), hash('f'), moderated.accountId, moderated.credentialId, opaque('t')],
      ),
    /verified password credential/,
  )

  const changes = [
    {
      authenticatedAt: 400,
      sessionId: opaque('d'),
      tokenHash: hash('9'),
      intentId: opaque('e'),
      secretHash: hash('a'),
      flowId: opaque('f'),
      idempotencyKey: hash('b'),
      intentConsumeNonce: opaque('g'),
      intentWriteNonce: opaque('h'),
      changeId: opaque('i'),
      credentialAuthNonce: opaque('j'),
      credentialChangeNonce: opaque('k'),
    },
    {
      authenticatedAt: 500,
      sessionId: opaque('l'),
      tokenHash: hash('c'),
      intentId: opaque('m'),
      secretHash: hash('d'),
      flowId: opaque('n'),
      idempotencyKey: hash('e'),
      intentConsumeNonce: opaque('o'),
      intentWriteNonce: opaque('p'),
      changeId: opaque('q'),
      credentialAuthNonce: opaque('r'),
      credentialChangeNonce: opaque('s'),
    },
  ]

  const performAuthenticatedChange = change => {
    const credential = database
      .prepare(`SELECT secret_version, revision FROM identity_password_credential WHERE id = ?`)
      .get(moderated.credentialId)
    const account = database
      .prepare('SELECT security_version FROM identity_account WHERE id = ?')
      .get(moderated.accountId)
    execute(
      `UPDATE identity_password_credential
       SET failed_attempt_count = 0, last_failed_at = NULL, locked_until = NULL,
           last_authenticated_at = ?, updated_at = ?, revision = ?, write_nonce = ?
       WHERE id = ?`,
      [
        change.authenticatedAt,
        change.authenticatedAt,
        credential.revision + 1,
        change.credentialAuthNonce,
        moderated.credentialId,
      ],
    )
    execute(
      `INSERT INTO identity_session
        (id, token_hash, account_id, security_version, auth_method, password_credential_id,
         password_verification_nonce, created_at, last_seen_at, idle_expires_at,
         absolute_expires_at, authenticated_at)
       VALUES (?, ?, ?, ?, 'password', ?, ?, ?, ?, ?, ?, ?)`,
      [
        change.sessionId,
        change.tokenHash,
        moderated.accountId,
        account.security_version,
        moderated.credentialId,
        change.credentialAuthNonce,
        change.authenticatedAt,
        change.authenticatedAt,
        change.authenticatedAt + 300,
        change.authenticatedAt + 400,
        change.authenticatedAt,
      ],
    )
    expectError(
      () =>
        execute(
          `INSERT INTO identity_session
            (id, token_hash, account_id, security_version, auth_method, password_credential_id,
             password_verification_nonce, created_at, last_seen_at, idle_expires_at,
             absolute_expires_at, authenticated_at)
           VALUES (?, ?, ?, ?, 'password', ?, ?, ?, ?, ?, ?, ?)`,
          [
            opaque('w'),
            change.authenticatedAt === 400 ? hash('f') : hash('2'),
            moderated.accountId,
            account.security_version,
            moderated.credentialId,
            change.credentialAuthNonce,
            change.authenticatedAt,
            change.authenticatedAt,
            change.authenticatedAt + 300,
            change.authenticatedAt + 400,
            change.authenticatedAt,
          ],
        ),
      /(?:insert conflict|UNIQUE)/,
    )
    execute(
      `INSERT INTO identity_auth_intent
        (id, secret_hash, purpose, expected_account_id, redirect_key, flow_id,
         idempotency_key, created_at, expires_at)
       VALUES (?, ?, 'sensitive_confirmation', ?, 'account', ?, ?, ?, ?)`,
      [
        change.intentId,
        change.secretHash,
        moderated.accountId,
        change.flowId,
        change.idempotencyKey,
        change.authenticatedAt,
        change.authenticatedAt + 300,
      ],
    )
    execute(
      `UPDATE identity_auth_intent
       SET consumed_at = ?, consume_nonce = ?, completion_result_type = 'password_credential',
           completion_result_ref = ?, revision = 1, write_nonce = ? WHERE id = ?`,
      [
        change.authenticatedAt,
        change.intentConsumeNonce,
        moderated.credentialId,
        change.intentWriteNonce,
        change.intentId,
      ],
    )
    execute(
      `INSERT INTO identity_password_change_confirmation
        (auth_intent_id, account_id, initiating_session_id, confirmation_method,
         proof_credential_id, confirmed_at)
       VALUES (?, ?, ?, 'password', ?, ?)`,
      [
        change.intentId,
        moderated.accountId,
        change.sessionId,
        moderated.credentialId,
        change.authenticatedAt,
      ],
    )
    execute(
      `INSERT INTO identity_password_change
        (id, credential_id, account_id, change_kind, authorizing_session_id,
         confirmation_auth_intent_id, from_secret_version, to_secret_version,
         target_security_version, changed_at, request_correlation_id)
       VALUES (?, ?, ?, 'authenticated_change', ?, ?, ?, ?, ?, ?, 'corr.password.change')`,
      [
        change.changeId,
        moderated.credentialId,
        moderated.accountId,
        change.sessionId,
        change.intentId,
        credential.secret_version,
        credential.secret_version + 1,
        account.security_version + 1,
        change.authenticatedAt + 1,
      ],
    )
    execute(
      `UPDATE identity_password_credential
       SET secret_version = secret_version + 1, parameters_json = ?, salt = ?,
           password_hash = ?, pepper_version = pepper_version + 1, last_change_id = ?,
           updated_at = ?, revision = revision + 1, write_nonce = ?
       WHERE id = ?`,
      [
        JSON.stringify({ m: 65536, t: credential.secret_version + 3, p: 1 }),
        Buffer.alloc(16, credential.secret_version + 2),
        Buffer.alloc(32, credential.secret_version + 3),
        change.changeId,
        change.authenticatedAt + 1,
        change.credentialChangeNonce,
        moderated.credentialId,
      ],
    )
  }

  for (const change of changes) performAuthenticatedChange(change)

  const finalCredential = database
    .prepare('SELECT secret_version FROM identity_password_credential WHERE id = ?')
    .get(moderated.credentialId)
  assert.equal(finalCredential.secret_version, 3)
  assert.equal(
    database
      .prepare('SELECT security_version FROM identity_account WHERE id = ?')
      .get(moderated.accountId).security_version,
    2,
  )
  assert.equal(
    database
      .prepare('SELECT COUNT(*) AS count FROM identity_password_change WHERE credential_id = ?')
      .get(moderated.credentialId).count,
    2,
  )
  assert.equal(
    database
      .prepare(
        'SELECT COUNT(*) AS count FROM identity_session WHERE account_id = ? AND revoked_at IS NULL',
      )
      .get(moderated.accountId).count,
    0,
  )

  console.log('moderated password schema tests passed')
} finally {
  database.close()
}

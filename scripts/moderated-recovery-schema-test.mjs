import assert from 'node:assert/strict'

import {
  createModeratedIdentityFixture,
  hash,
  moderated,
  opaque,
} from './moderated-identity-schema-fixture.mjs'

const { database, execute, expectError, registerPasswordAccount } =
  await createModeratedIdentityFixture()

const useAt = 86_400_400
const caseId = opaque('a')
const authorizationId = opaque('b')

try {
  registerPasswordAccount()
  execute(
    `UPDATE identity_password_credential
     SET last_authenticated_at = 450, updated_at = 450, revision = 1, write_nonce = ?
     WHERE id = ?`,
    [opaque('c'), moderated.credentialId],
  )
  const targetSessionId = opaque('d')
  execute(
    `INSERT INTO identity_session
      (id, token_hash, account_id, security_version, auth_method, password_credential_id,
       password_verification_nonce, created_at, last_seen_at, idle_expires_at,
       absolute_expires_at, authenticated_at)
     VALUES (?, ?, ?, 0, 'password', ?, ?, 450, 450, 900, 950, 450)`,
    [targetSessionId, hash('4'), moderated.accountId, moderated.credentialId, opaque('c')],
  )
  execute(
    `INSERT INTO identity_role_assignment
      (id, account_id, role, scope_type, grant_reason, granted_at)
     VALUES (?, ?, 'identity_reviewer', 'platform', 'Self-review rejection test', 440)`,
    [opaque('e'), moderated.accountId],
  )
  execute(
    `INSERT INTO identity_assisted_recovery_case
      (id, account_id, receipt_hash, evidence_statement, requested_at, not_before_at, expires_at)
     VALUES (?, ?, ?, 'Account ownership evidence submitted', 400, ?, 90000000)`,
    [caseId, moderated.accountId, hash('5'), useAt],
  )
  expectError(
    () =>
      execute(
        `INSERT INTO identity_assisted_recovery_review
          (id, case_id, reviewer_account_id, reviewer_session_id, decision, reason,
           decided_at, request_correlation_id)
         VALUES (?, ?, ?, ?, 'approved', 'Self approval must never succeed', 500,
           'corr.recovery.self')`,
        [opaque('f'), caseId, moderated.accountId, targetSessionId],
      ),
    /different current identity reviewer/,
  )
  const reviewId = opaque('g')
  execute(
    `INSERT INTO identity_assisted_recovery_review
      (id, case_id, reviewer_account_id, reviewer_session_id, decision, reason,
       decided_at, request_correlation_id)
     VALUES (?, ?, ?, ?, 'approved', 'Evidence independently reviewed', 500,
       'corr.recovery.approve')`,
    [reviewId, caseId, moderated.reviewerAccountId, moderated.reviewerSessionId],
  )
  execute(
    `UPDATE identity_assisted_recovery_case
     SET status = 'approved', review_id = ?, reviewed_at = 500,
         revision = 1, write_nonce = ? WHERE id = ?`,
    [reviewId, opaque('h'), caseId],
  )
  execute(
    `INSERT INTO identity_assisted_recovery_authorization
      (id, case_id, receipt_hash, secret_hash, issued_at, not_before_at, expires_at)
     VALUES (?, ?, ?, ?, 600, ?, 87000000)`,
    [authorizationId, caseId, hash('5'), hash('6'), useAt],
  )

  const earlyIntentId = opaque('i')
  execute(
    `INSERT INTO identity_auth_intent
      (id, secret_hash, purpose, expected_account_id, redirect_key, flow_id,
       idempotency_key, created_at, expires_at)
     VALUES (?, ?, 'recovery', ?, 'account', ?, ?, 700, 900)`,
    [earlyIntentId, hash('7'), moderated.accountId, opaque('j'), hash('8')],
  )
  expectError(
    () =>
      execute(
        `UPDATE identity_assisted_recovery_authorization
         SET consumed_auth_intent_id = ?, consumed_at = 800, consume_nonce = ? WHERE id = ?`,
        [earlyIntentId, opaque('k'), authorizationId],
      ),
    /consumption conflict/,
  )

  const recoveryIntentId = opaque('l')
  execute(
    `INSERT INTO identity_auth_intent
      (id, secret_hash, purpose, expected_account_id, redirect_key, flow_id,
       idempotency_key, created_at, expires_at)
     VALUES (?, ?, 'recovery', ?, 'account', ?, ?, ?, ?)`,
    [recoveryIntentId, hash('9'), moderated.accountId, opaque('m'), hash('a'), useAt, useAt + 1000],
  )
  execute(
    `UPDATE identity_assisted_recovery_authorization
     SET consumed_auth_intent_id = ?, consumed_at = ?, consume_nonce = ? WHERE id = ?`,
    [recoveryIntentId, useAt, opaque('n'), authorizationId],
  )
  execute(
    `UPDATE identity_auth_intent
     SET consumed_at = ?, consume_nonce = ?, completion_result_type = 'assisted_recovery',
         completion_result_ref = ?, revision = 1, write_nonce = ? WHERE id = ?`,
    [useAt, opaque('o'), authorizationId, opaque('p'), recoveryIntentId],
  )
  execute(
    `UPDATE identity_assisted_recovery_case
     SET status = 'consumed', consumed_at = ?, revision = 2, write_nonce = ? WHERE id = ?`,
    [useAt, opaque('q'), caseId],
  )
  const recoverySessionId = opaque('s')
  execute(
    `INSERT INTO identity_session
      (id, token_hash, account_id, security_version, auth_method, recovery_auth_intent_id,
       created_at, last_seen_at, idle_expires_at, absolute_expires_at, authenticated_at,
       recovery_verified_at, recovery_restricted)
     VALUES (?, ?, ?, 0, 'assisted_recovery', ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      recoverySessionId,
      hash('c'),
      moderated.accountId,
      recoveryIntentId,
      useAt,
      useAt,
      useAt + 300,
      useAt + 600,
      useAt,
      useAt,
    ],
  )
  const recoveryChangeId = opaque('t')
  execute(
    `INSERT INTO identity_password_change
      (id, credential_id, account_id, change_kind, authorizing_session_id,
       assisted_recovery_case_id, from_secret_version, to_secret_version,
       target_security_version, changed_at, request_correlation_id)
     VALUES (?, ?, ?, 'assisted_recovery', ?, ?, 1, 2, 1, ?, 'corr.recovery.reset')`,
    [
      recoveryChangeId,
      moderated.credentialId,
      moderated.accountId,
      recoverySessionId,
      caseId,
      useAt + 1,
    ],
  )
  execute(
    `UPDATE identity_password_credential
     SET secret_version = 2, parameters_json = '{"m":65536,"t":4,"p":1}', salt = ?,
         password_hash = ?, pepper_version = 2, failed_attempt_count = 0,
         last_failed_at = NULL, locked_until = NULL, last_change_id = ?, updated_at = ?,
         revision = revision + 1, write_nonce = ? WHERE id = ?`,
    [
      Buffer.alloc(16, 7),
      Buffer.alloc(32, 8),
      recoveryChangeId,
      useAt + 1,
      opaque('u'),
      moderated.credentialId,
    ],
  )
  assert.equal(
    database
      .prepare('SELECT security_version FROM identity_account WHERE id = ?')
      .get(moderated.accountId).security_version,
    1,
  )
  assert.equal(
    database.prepare('SELECT revoked_at FROM identity_session WHERE id = ?').get(recoverySessionId)
      .revoked_at,
    useAt + 1,
  )
  assert.equal(
    database
      .prepare('SELECT phishing_resistant_at FROM identity_session WHERE id = ?')
      .get(recoverySessionId).phishing_resistant_at,
    null,
  )

  const nextAuthAt = useAt + 100
  execute(
    `UPDATE identity_password_credential
     SET last_authenticated_at = ?, updated_at = ?, revision = 3, write_nonce = ? WHERE id = ?`,
    [nextAuthAt, nextAuthAt, opaque('v'), moderated.credentialId],
  )
  const nextSessionId = opaque('v')
  execute(
    `INSERT INTO identity_session
      (id, token_hash, account_id, security_version, auth_method, password_credential_id,
       password_verification_nonce, created_at, last_seen_at, idle_expires_at,
       absolute_expires_at, authenticated_at)
     VALUES (?, ?, ?, 1, 'password', ?, ?, ?, ?, ?, ?, ?)`,
    [
      nextSessionId,
      hash('d'),
      moderated.accountId,
      moderated.credentialId,
      opaque('v'),
      nextAuthAt,
      nextAuthAt,
      nextAuthAt + 300,
      nextAuthAt + 400,
      nextAuthAt,
    ],
  )
  const confirmationId = opaque('w')
  execute(
    `INSERT INTO identity_auth_intent
      (id, secret_hash, purpose, expected_account_id, redirect_key, flow_id,
       idempotency_key, created_at, expires_at)
     VALUES (?, ?, 'sensitive_confirmation', ?, 'account', ?, ?, ?, ?)`,
    [
      confirmationId,
      hash('e'),
      moderated.accountId,
      opaque('x'),
      hash('f'),
      nextAuthAt,
      nextAuthAt + 300,
    ],
  )
  execute(
    `UPDATE identity_auth_intent SET consumed_at = ?, consume_nonce = ?,
       completion_result_type = 'password_credential', completion_result_ref = ?,
       revision = 1, write_nonce = ? WHERE id = ?`,
    [nextAuthAt, opaque('x'), moderated.credentialId, opaque('y'), confirmationId],
  )
  execute(
    `INSERT INTO identity_password_change_confirmation
      (auth_intent_id, account_id, initiating_session_id, confirmation_method,
       proof_credential_id, confirmed_at) VALUES (?, ?, ?, 'password', ?, ?)`,
    [confirmationId, moderated.accountId, nextSessionId, moderated.credentialId, nextAuthAt],
  )
  const nextChangeId = opaque('z')
  execute(
    `INSERT INTO identity_password_change
      (id, credential_id, account_id, change_kind, authorizing_session_id,
       confirmation_auth_intent_id, from_secret_version, to_secret_version,
       target_security_version, changed_at, request_correlation_id)
     VALUES (?, ?, ?, 'authenticated_change', ?, ?, 2, 3, 2, ?, 'corr.password.after.recovery')`,
    [
      nextChangeId,
      moderated.credentialId,
      moderated.accountId,
      nextSessionId,
      confirmationId,
      nextAuthAt + 1,
    ],
  )
  execute(
    `UPDATE identity_password_credential SET secret_version = 3, salt = ?, password_hash = ?,
       last_change_id = ?, updated_at = ?, revision = 4, write_nonce = ? WHERE id = ?`,
    [
      Buffer.alloc(16, 9),
      Buffer.alloc(32, 10),
      nextChangeId,
      nextAuthAt + 1,
      opaque('z'),
      moderated.credentialId,
    ],
  )
  assert.equal(
    database
      .prepare('SELECT security_version FROM identity_account WHERE id = ?')
      .get(moderated.accountId).security_version,
    2,
  )
  assert.equal(
    database
      .prepare('SELECT COUNT(*) count FROM identity_password_change WHERE account_id = ?')
      .get(moderated.accountId).count,
    2,
  )

  console.log('moderated assisted recovery schema tests passed')
} finally {
  database.close()
}

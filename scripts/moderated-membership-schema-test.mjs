import assert from 'node:assert/strict'

import {
  account,
  createModeratedIdentityFixture,
  hash,
  moderated,
  opaque,
} from './moderated-identity-schema-fixture.mjs'

const { database, execute, expectError, registerPasswordAccount } =
  await createModeratedIdentityFixture()

const insertDraft = ({ id, accountId, sessionId, at }) =>
  execute(
    `INSERT INTO identity_membership_application
      (id, account_id, last_applicant_update_at, last_applicant_session_id,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, accountId, at, sessionId, at, at],
  )

try {
  registerPasswordAccount()
  const applicantSessionId = opaque('a')
  const verificationNonce = opaque('b')
  execute(
    `UPDATE identity_password_credential
     SET last_authenticated_at = 200, updated_at = 200, revision = 1, write_nonce = ?
     WHERE id = ?`,
    [verificationNonce, moderated.credentialId],
  )
  execute(
    `INSERT INTO identity_session
      (id, token_hash, account_id, security_version, auth_method, password_credential_id,
       password_verification_nonce, created_at, last_seen_at, idle_expires_at,
       absolute_expires_at, authenticated_at)
     VALUES (?, ?, ?, 0, 'password', ?, ?, 200, 200, 900, 1000, 200)`,
    [applicantSessionId, hash('2'), moderated.accountId, moderated.credentialId, verificationNonce],
  )

  insertDraft({
    id: moderated.applicationId,
    accountId: moderated.accountId,
    sessionId: applicantSessionId,
    at: 250,
  })
  execute(
    `UPDATE identity_membership_application
     SET identity_claim = 'NBT student 20260001', last_applicant_update_at = 260,
         updated_at = 260, revision = 1, write_nonce = ? WHERE id = ?`,
    [opaque('c'), moderated.applicationId],
  )
  execute(
    `UPDATE identity_membership_application
     SET contact = 'player@example.test', application_reason = 'Join tournament registrations',
         status = 'pending', submission_version = 1, submission_digest = ?, submitted_at = 270,
         last_applicant_update_at = 270, updated_at = 270, revision = 2, write_nonce = ?
     WHERE id = ?`,
    [hash('3'), opaque('d'), moderated.applicationId],
  )
  expectError(
    () =>
      insertDraft({
        id: opaque('e'),
        accountId: moderated.accountId,
        sessionId: applicantSessionId,
        at: 275,
      }),
    /(?:insert conflict|UNIQUE)/,
  )
  expectError(
    () =>
      execute(
        `UPDATE identity_membership_application
         SET status = 'in_review', assigned_reviewer_account_id = ?,
             assigned_reviewer_session_id = ?, review_started_at = 280, updated_at = 280,
             revision = 3, write_nonce = ? WHERE id = ?`,
        [account.alpha, applicantSessionId, opaque('f'), moderated.applicationId],
      ),
    /current identity reviewer/,
  )
  execute(
    `UPDATE identity_membership_application
     SET status = 'in_review', assigned_reviewer_account_id = ?,
         assigned_reviewer_session_id = ?, review_started_at = 280, updated_at = 280,
         revision = 3, write_nonce = ? WHERE id = ?`,
    [
      moderated.reviewerAccountId,
      moderated.reviewerSessionId,
      opaque('g'),
      moderated.applicationId,
    ],
  )
  expectError(
    () =>
      execute(
        `UPDATE identity_membership_application
         SET contact = 'changed@example.test', updated_at = 290, revision = 4, write_nonce = ?
         WHERE id = ?`,
        [opaque('h'), moderated.applicationId],
      ),
    /state conflict/,
  )

  execute(
    `INSERT INTO identity_membership_review
      (id, application_id, submission_version, submission_digest, reviewer_account_id,
       reviewer_session_id, decision, reason, decided_at, request_correlation_id)
     VALUES (?, ?, 1, ?, ?, ?, 'changes_requested', 'Please clarify the identity evidence', 300,
       'corr.membership.changes')`,
    [
      moderated.reviewId,
      moderated.applicationId,
      hash('3'),
      moderated.reviewerAccountId,
      moderated.reviewerSessionId,
    ],
  )
  execute(
    `UPDATE identity_membership_application
     SET status = 'changes_requested', latest_review_id = ?, latest_reviewed_at = 300,
         updated_at = 300, revision = 4, write_nonce = ? WHERE id = ?`,
    [moderated.reviewId, opaque('i'), moderated.applicationId],
  )
  expectError(
    () =>
      execute('UPDATE identity_membership_review SET reason = ? WHERE id = ?', [
        'Mutated decision',
        moderated.reviewId,
      ]),
    /append-only/,
  )
  execute(
    `UPDATE identity_membership_application
     SET status = 'draft', identity_claim = 'NBT student 20260001, verified class list',
         submission_digest = NULL, submitted_at = NULL, assigned_reviewer_account_id = NULL,
         assigned_reviewer_session_id = NULL, review_started_at = NULL,
         last_applicant_update_at = 310, last_applicant_session_id = ?, updated_at = 310,
         revision = 5, write_nonce = ? WHERE id = ?`,
    [applicantSessionId, opaque('j'), moderated.applicationId],
  )
  execute(
    `UPDATE identity_membership_application
     SET status = 'pending', submission_version = 2, submission_digest = ?, submitted_at = 320,
         last_applicant_update_at = 320, updated_at = 320, revision = 6, write_nonce = ?
     WHERE id = ?`,
    [hash('4'), opaque('k'), moderated.applicationId],
  )
  execute(
    `UPDATE identity_membership_application
     SET status = 'in_review', assigned_reviewer_account_id = ?,
         assigned_reviewer_session_id = ?, review_started_at = 330, updated_at = 330,
         revision = 7, write_nonce = ? WHERE id = ?`,
    [
      moderated.reviewerAccountId,
      moderated.reviewerSessionId,
      opaque('l'),
      moderated.applicationId,
    ],
  )
  const approvalReviewId = opaque('m')
  execute(
    `INSERT INTO identity_membership_review
      (id, application_id, submission_version, submission_digest, reviewer_account_id,
       reviewer_session_id, decision, reason, decided_at, request_correlation_id)
     VALUES (?, ?, 2, ?, ?, ?, 'approved', 'Eligibility evidence accepted', 350,
       'corr.membership.approved')`,
    [
      approvalReviewId,
      moderated.applicationId,
      hash('4'),
      moderated.reviewerAccountId,
      moderated.reviewerSessionId,
    ],
  )
  execute(
    `UPDATE identity_membership_application
     SET status = 'approved', latest_review_id = ?, latest_reviewed_at = 350,
         updated_at = 350, revision = 8, write_nonce = ? WHERE id = ?`,
    [approvalReviewId, opaque('n'), moderated.applicationId],
  )
  execute(
    `INSERT INTO identity_membership
      (id, account_id, application_id, approved_review_id, approved_at)
     VALUES (?, ?, ?, ?, 350)`,
    [moderated.membershipId, moderated.accountId, moderated.applicationId, approvalReviewId],
  )
  assert.equal(
    database
      .prepare(
        `SELECT EXISTS(
           SELECT 1 FROM identity_membership
           WHERE account_id = ? AND status = 'approved'
         ) AS allowed`,
      )
      .get(moderated.accountId).allowed,
    1,
  )
  expectError(
    () =>
      insertDraft({
        id: opaque('o'),
        accountId: moderated.accountId,
        sessionId: applicantSessionId,
        at: 360,
      }),
    /account draft/,
  )

  const nonMemberSessionId = opaque('p')
  execute(
    `INSERT INTO identity_session
      (id, token_hash, account_id, security_version, auth_method, created_at, last_seen_at,
       idle_expires_at, absolute_expires_at, authenticated_at)
     VALUES (?, ?, ?, 0, 'oidc', 400, 400, 900, 1000, 400)`,
    [nonMemberSessionId, hash('5'), account.alpha],
  )
  const rejectedApplicationId = opaque('q')
  insertDraft({
    id: rejectedApplicationId,
    accountId: account.alpha,
    sessionId: nonMemberSessionId,
    at: 410,
  })
  execute(
    `UPDATE identity_membership_application
     SET identity_claim = 'External participant record', contact = 'alpha@example.test',
         status = 'pending', submission_version = 1, submission_digest = ?, submitted_at = 420,
         last_applicant_update_at = 420, updated_at = 420, revision = 1, write_nonce = ?
     WHERE id = ?`,
    [hash('6'), opaque('r'), rejectedApplicationId],
  )
  execute(
    `UPDATE identity_membership_application
     SET status = 'in_review', assigned_reviewer_account_id = ?,
         assigned_reviewer_session_id = ?, review_started_at = 430, updated_at = 430,
         revision = 2, write_nonce = ? WHERE id = ?`,
    [moderated.reviewerAccountId, moderated.reviewerSessionId, opaque('s'), rejectedApplicationId],
  )
  const rejectionReviewId = opaque('t')
  execute(
    `INSERT INTO identity_membership_review
      (id, application_id, submission_version, submission_digest, reviewer_account_id,
       reviewer_session_id, decision, reason, decided_at, request_correlation_id)
     VALUES (?, ?, 1, ?, ?, ?, 'rejected', 'Evidence is not currently eligible', 440,
       'corr.membership.rejected')`,
    [
      rejectionReviewId,
      rejectedApplicationId,
      hash('6'),
      moderated.reviewerAccountId,
      moderated.reviewerSessionId,
    ],
  )
  execute(
    `UPDATE identity_membership_application
     SET status = 'rejected', latest_review_id = ?, latest_reviewed_at = 440,
         updated_at = 440, revision = 3, write_nonce = ? WHERE id = ?`,
    [rejectionReviewId, opaque('u'), rejectedApplicationId],
  )
  assert.equal(
    database.prepare('SELECT revoked_at FROM identity_session WHERE id = ?').get(nonMemberSessionId)
      .revoked_at,
    null,
  )
  assert.equal(
    database
      .prepare(
        "SELECT COUNT(*) count FROM identity_membership WHERE account_id = ? AND status = 'approved'",
      )
      .get(account.alpha).count,
    0,
  )
  const replacementApplicationId = opaque('v')
  insertDraft({
    id: replacementApplicationId,
    accountId: account.alpha,
    sessionId: nonMemberSessionId,
    at: 450,
  })
  execute(
    `UPDATE identity_membership_application
     SET status = 'withdrawn', last_applicant_update_at = 460, updated_at = 460,
         revision = 1, write_nonce = ? WHERE id = ?`,
    [opaque('w'), replacementApplicationId],
  )
  insertDraft({
    id: opaque('x'),
    accountId: account.alpha,
    sessionId: nonMemberSessionId,
    at: 470,
  })

  console.log('moderated membership state-machine schema tests passed')
} finally {
  database.close()
}

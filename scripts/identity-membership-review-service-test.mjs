import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
const cookiesModule = dataModule(
  `export async function cookies() { throw new Error('Unexpected cookie transport') }`,
)
const bindingsModule = dataModule(
  `export function cloudflareBindings() { throw new Error('Unexpected production binding') }`,
)
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: dataModule('export {}'), shortCircuit: true }
    if (specifier === 'next/headers') return { url: cookiesModule, shortCircuit: true }
    if (specifier === '../cloudflare-bindings.ts')
      return { url: bindingsModule, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

const { createMembershipDraft, getMembershipState, saveMembershipDraft } =
  await import('../lib/identity/membership.ts')
const { resubmitMembershipApplication, submitMembershipApplication } =
  await import('../lib/identity/membership-application.ts')
const { claimMembershipApplication, reviewMembershipApplication } =
  await import('../lib/identity/membership-review.ts')
const { listMembershipReviewQueue, recordMembershipReviewReminder } =
  await import('../lib/identity/membership-review-queue.ts')
const { MEMBERSHIP_REVIEW_OVERDUE_MS } =
  await import('../lib/identity/internal/membership-policy.ts')
const { accountIds, createIdentityKernelFixture, credentialIds, passwordCredentialIds } =
  await import('./identity-kernel-test-fixture.mjs')

const fixture = await createIdentityKernelFixture()
const { database, db, now } = fixture

async function createSubmitted(context, fields, at) {
  const created = await createMembershipDraft(db, context, {}, { now: at })
  if (!created.ok) throw new Error(`Draft creation failed: ${created.reason}`)
  const saved = await saveMembershipDraft(
    db,
    context,
    { applicationId: created.application.id, revision: 0, ...fields },
    { now: at + 1 },
  )
  if (!saved.ok) throw new Error(`Draft save failed: ${saved.reason}`)
  const submitted = await submitMembershipApplication(
    db,
    context,
    { applicationId: saved.application.id, revision: saved.application.revision },
    { now: at + 2 },
  )
  if (!submitted.ok) throw new Error(`Submission failed: ${submitted.reason}`)
  return submitted.application
}

try {
  const applicant = await fixture.session(accountIds.owner, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.owner,
  })
  const unrelated = await fixture.session(accountIds.manager, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.manager,
  })
  const reviewer = await fixture.session(accountIds.reviewer, {
    method: 'password',
    passwordCredentialId: passwordCredentialIds.reviewer,
  })
  const application = await createSubmitted(
    applicant.context,
    {
      identityClaim: 'NBT student 20260001',
      contact: 'owner@example.test',
      applicationReason: 'Tournament eligibility',
    },
    now + 1,
  )

  assert.deepEqual(await listMembershipReviewQueue(db, unrelated.context, { now: now + 4 }), {
    ok: false,
    reason: 'forbidden',
  })
  const initialQueue = await listMembershipReviewQueue(db, reviewer.context, { now: now + 4 })
  assert.equal(initialQueue.ok, true)
  assert.equal(initialQueue.ok && initialQueue.applications[0]?.id, application.id)
  assert.equal(initialQueue.ok && initialQueue.applications[0]?.overdue, false)

  const claimed = await claimMembershipApplication(
    db,
    reviewer.context,
    { applicationId: application.id, revision: application.revision },
    { now: now + 5 },
  )
  assert.equal(claimed.ok, true)
  if (!claimed.ok) throw new Error('Expected reviewer claim')
  assert.equal(claimed.application.status, 'in_review')
  assert.deepEqual(
    await reviewMembershipApplication(
      db,
      reviewer.context,
      {
        applicationId: application.id,
        revision: claimed.application.revision,
        submissionVersion: claimed.application.submissionVersion,
        submissionDigest: '0'.repeat(64),
        decision: 'approved',
        reason: 'Digest mismatch must fail',
      },
      { now: now + 6 },
    ),
    { ok: false, reason: 'conflict' },
  )
  const changesRequested = await reviewMembershipApplication(
    db,
    reviewer.context,
    {
      applicationId: application.id,
      revision: claimed.application.revision,
      submissionVersion: claimed.application.submissionVersion,
      submissionDigest: claimed.application.submissionDigest,
      decision: 'changes_requested',
      reason: 'Please clarify the eligibility evidence',
    },
    { now: now + 7 },
  )
  assert.equal(changesRequested.ok, true)
  if (!changesRequested.ok) throw new Error('Expected changes request')

  const resubmitted = await resubmitMembershipApplication(
    db,
    applicant.context,
    {
      applicationId: application.id,
      revision: changesRequested.application.revision,
      identityClaim: 'NBT student 20260001, class list confirmed',
      contact: 'owner@example.test',
      applicationReason: 'Tournament eligibility',
    },
    { now: now + 8 },
  )
  assert.equal(resubmitted.ok, true)
  if (!resubmitted.ok) throw new Error('Expected resubmission')
  assert.equal(resubmitted.application.submissionVersion, 2)
  assert.notEqual(resubmitted.application.submissionDigest, application.submissionDigest)
  const reclaimed = await claimMembershipApplication(
    db,
    reviewer.context,
    { applicationId: application.id, revision: resubmitted.application.revision },
    { now: now + 9 },
  )
  if (!reclaimed.ok) throw new Error('Expected reclaimed application')
  const approved = await reviewMembershipApplication(
    db,
    reviewer.context,
    {
      applicationId: application.id,
      revision: reclaimed.application.revision,
      submissionVersion: reclaimed.application.submissionVersion,
      submissionDigest: reclaimed.application.submissionDigest,
      decision: 'approved',
      reason: 'Eligibility evidence accepted',
    },
    { now: now + 10 },
  )
  assert.equal(approved.ok, true)
  assert.match(approved.ok ? approved.membershipId : '', /^[A-Za-z0-9_-]{43}$/)
  const approvedState = await getMembershipState(db, applicant.context, { now: now + 11 })
  assert.equal(approvedState.ok && approvedState.membership?.status, 'approved')

  const pending = await createSubmitted(
    unrelated.context,
    { identityClaim: 'External participant record', contact: 'manager@example.test' },
    now + 20,
  )
  const dueAt = pending.submittedAt + MEMBERSHIP_REVIEW_OVERDUE_MS
  const freshReviewer = await fixture.session(
    accountIds.reviewer,
    { method: 'password', passwordCredentialId: passwordCredentialIds.reviewer },
    dueAt,
  )
  const overdueQueue = await listMembershipReviewQueue(db, freshReviewer.context, { now: dueAt })
  assert.equal(overdueQueue.ok && overdueQueue.applications[0]?.id, pending.id)
  assert.equal(overdueQueue.ok && overdueQueue.applications[0]?.reminderEligible, true)
  assert.deepEqual(
    await recordMembershipReviewReminder(db, freshReviewer.context, pending.id, { now: dueAt }),
    { ok: false, reason: 'not_found' },
  )
  const reminded = await recordMembershipReviewReminder(db, unrelated.context, pending.id, {
    now: dueAt,
  })
  assert.equal(reminded.ok, true)
  const reminderEvent = await db
    .prepare(
      `SELECT actor_account_id, actor_session_id, target_account_id
       FROM identity_security_event
       WHERE event_type = 'membership.application.review_reminder'
         AND resource_type = 'membership_application' AND resource_id = ?`,
    )
    .bind(pending.id)
    .first()
  assert.deepEqual(
    { ...reminderEvent },
    {
      actor_account_id: accountIds.manager,
      actor_session_id: unrelated.context.session.id,
      target_account_id: accountIds.manager,
    },
  )
  assert.deepEqual(
    await recordMembershipReviewReminder(db, unrelated.context, pending.id, { now: dueAt + 1 }),
    { ok: false, reason: 'not_eligible' },
  )
  const queueAfterReminder = await listMembershipReviewQueue(db, freshReviewer.context, {
    now: dueAt + 2,
  })
  assert.equal(queueAfterReminder.ok && queueAfterReminder.applications[0]?.lastReminderAt, dueAt)
  assert.equal(queueAfterReminder.ok && queueAfterReminder.applications[0]?.reminderEligible, false)

  const pendingClaim = await claimMembershipApplication(
    db,
    freshReviewer.context,
    { applicationId: pending.id, revision: pending.revision },
    { now: dueAt + 3 },
  )
  if (!pendingClaim.ok) throw new Error('Expected pending claim')
  const rejected = await reviewMembershipApplication(
    db,
    freshReviewer.context,
    {
      applicationId: pending.id,
      revision: pendingClaim.application.revision,
      submissionVersion: pendingClaim.application.submissionVersion,
      submissionDigest: pendingClaim.application.submissionDigest,
      decision: 'rejected',
      reason: 'Evidence is not currently eligible',
    },
    { now: dueAt + 4 },
  )
  assert.equal(rejected.ok, true)
  const rejectedState = await getMembershipState(db, unrelated.context, { now: dueAt + 5 })
  assert.equal(rejectedState.ok && rejectedState.application?.status, 'rejected')
  assert.equal(rejectedState.ok && rejectedState.membership, null)
  assert.equal(
    (await createMembershipDraft(db, unrelated.context, {}, { now: dueAt + 6 })).ok,
    true,
  )

  console.log('identity membership reviewer service tests passed')
} finally {
  database.close()
}

const { createMembershipDraft } = await import('../lib/identity/membership.ts')
const { submitMembershipApplication } = await import('../lib/identity/membership-application.ts')
const { claimMembershipApplication, reviewMembershipApplication } =
  await import('../lib/identity/membership-review.ts')

export async function approveMembership(db, context, reviewer, at) {
  const draft = await createMembershipDraft(
    db,
    context,
    {
      identityClaim: `Approved member ${context.account.displayName}`,
      contact: `${context.account.displayName}@example.test`,
      applicationReason: 'Fixture approval',
    },
    { now: at },
  )
  if (!draft.ok) throw new Error(`Could not create membership draft: ${draft.reason}`)
  const submitted = await submitMembershipApplication(
    db,
    context,
    { applicationId: draft.application.id, revision: draft.application.revision },
    { now: at + 1 },
  )
  if (!submitted.ok) throw new Error(`Could not submit membership: ${submitted.reason}`)
  const claimed = await claimMembershipApplication(
    db,
    reviewer,
    { applicationId: submitted.application.id, revision: submitted.application.revision },
    { now: at + 2 },
  )
  if (!claimed.ok) throw new Error(`Could not claim membership: ${claimed.reason}`)
  const approved = await reviewMembershipApplication(
    db,
    reviewer,
    {
      applicationId: claimed.application.id,
      revision: claimed.application.revision,
      submissionVersion: claimed.application.submissionVersion,
      submissionDigest: claimed.application.submissionDigest,
      decision: 'approved',
      reasonCategory: 'eligible',
      reason: 'Fixture approval',
    },
    { now: at + 3 },
  )
  if (!approved.ok) throw new Error(`Could not approve membership: ${approved.reason}`)
}

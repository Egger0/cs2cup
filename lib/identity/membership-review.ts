import 'server-only'

import { createOpaqueToken } from '../opaque-token.ts'
import type { AuthenticatedAuthContext, IdentityDatabase } from './internal/contracts.ts'
import {
  membershipSnapshot,
  type MembershipApplicationSnapshot,
} from './internal/membership-command.ts'
import {
  reviewerAuthorizationFailure,
  reviewerSecurityEvent,
  type ReviewerFailure,
} from './internal/membership-reviewer.ts'
import {
  isMembershipMutationConflict,
  membershipApplicationById,
  membershipOperation,
  validApplicationReference,
  type MembershipOperationOptions,
} from './internal/membership-store.ts'
import {
  normalizeMembershipReviewReason,
  type MembershipReviewDecision,
} from './internal/membership-policy.ts'

export type MembershipReviewFailure = ReviewerFailure | 'not_found' | 'invalid_state' | 'conflict'

export async function claimMembershipApplication(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  input: { readonly applicationId: string; readonly revision: number },
  options: MembershipOperationOptions = {},
) {
  const operation = membershipOperation(options)
  if (!validApplicationReference(input.applicationId, input.revision)) {
    return { ok: false, reason: 'invalid_input' } as const
  }
  const denied = await reviewerAuthorizationFailure(database, context, operation.now)
  if (denied) return { ok: false, reason: denied } as const
  const application = await membershipApplicationById(database, input.applicationId)
  if (!application) return { ok: false, reason: 'not_found' } as const
  if (application.revision !== input.revision) return { ok: false, reason: 'conflict' } as const
  if (application.status !== 'pending') return { ok: false, reason: 'invalid_state' } as const
  try {
    // The application cannot be deleted, so targeting its immutable id lets the revision trigger
    // fail stale claims atomically instead of allowing an unaudited zero-row CAS.
    await database.batch([
      database
        .prepare(
          `UPDATE identity_membership_application
           SET status = 'in_review', assigned_reviewer_account_id = ?,
               assigned_reviewer_session_id = ?, review_started_at = ?, updated_at = ?,
               revision = ?, write_nonce = ? WHERE id = ?`,
        )
        .bind(
          context.account.id,
          context.session.id,
          operation.now,
          operation.now,
          input.revision + 1,
          createOpaqueToken(),
          input.applicationId,
        ),
      await reviewerSecurityEvent(
        database,
        context,
        application,
        'membership.application.review_started',
        operation,
        { submissionVersion: application.submission_version },
      ),
    ])
  } catch (error) {
    if (isMembershipMutationConflict(error)) return { ok: false, reason: 'conflict' } as const
    throw error
  }
  const claimed = await membershipApplicationById(database, input.applicationId)
  if (!claimed) throw new Error('Claimed membership application disappeared')
  return { ok: true, application: membershipSnapshot(claimed) } as const
}

export interface ReviewMembershipApplicationInput {
  readonly applicationId: string
  readonly revision: number
  readonly submissionVersion: number
  readonly submissionDigest: string
  readonly decision: MembershipReviewDecision
  readonly reason: string
}

export async function reviewMembershipApplication(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  input: ReviewMembershipApplicationInput,
  options: MembershipOperationOptions = {},
): Promise<
  | {
      readonly ok: true
      readonly application: MembershipApplicationSnapshot
      readonly membershipId: string | null
    }
  | { readonly ok: false; readonly reason: MembershipReviewFailure }
> {
  const operation = membershipOperation(options)
  const reason = normalizeMembershipReviewReason(input.reason)
  const valid =
    validApplicationReference(input.applicationId, input.revision) &&
    Number.isSafeInteger(input.submissionVersion) &&
    input.submissionVersion >= 1 &&
    /^[0-9a-f]{64}$/.test(input.submissionDigest) &&
    ['approved', 'changes_requested', 'rejected'].includes(input.decision) &&
    reason.ok
  if (!valid) return { ok: false, reason: 'invalid_input' }
  const denied = await reviewerAuthorizationFailure(database, context, operation.now)
  if (denied) return { ok: false, reason: denied }
  const application = await membershipApplicationById(database, input.applicationId)
  if (!application) return { ok: false, reason: 'not_found' }
  if (
    application.revision !== input.revision ||
    application.submission_version !== input.submissionVersion ||
    application.submission_digest !== input.submissionDigest
  ) {
    return { ok: false, reason: 'conflict' }
  }
  if (
    application.status !== 'in_review' ||
    application.assigned_reviewer_account_id !== context.account.id
  ) {
    return { ok: false, reason: 'invalid_state' }
  }
  const reviewId = createOpaqueToken()
  const membershipId = input.decision === 'approved' ? createOpaqueToken() : null
  const statements = [
    database
      .prepare(
        `INSERT INTO identity_membership_review
          (id, application_id, submission_version, submission_digest, reviewer_account_id,
           reviewer_session_id, decision, reason, decided_at, request_correlation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        reviewId,
        application.id,
        input.submissionVersion,
        input.submissionDigest,
        context.account.id,
        context.session.id,
        input.decision,
        reason.ok ? reason.value : '',
        operation.now,
        operation.correlationId,
      ),
    database
      .prepare(
        `UPDATE identity_membership_application
         SET status = ?, latest_review_id = ?, latest_reviewed_at = ?, updated_at = ?,
             revision = ?, write_nonce = ? WHERE id = ?`,
      )
      .bind(
        input.decision,
        reviewId,
        operation.now,
        operation.now,
        input.revision + 1,
        createOpaqueToken(),
        application.id,
      ),
  ]
  if (membershipId) {
    statements.push(
      database
        .prepare(
          `INSERT INTO identity_membership
            (id, account_id, application_id, approved_review_id, approved_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(membershipId, application.account_id, application.id, reviewId, operation.now),
    )
  }
  statements.push(
    await reviewerSecurityEvent(
      database,
      context,
      application,
      `membership.application.${input.decision}`,
      operation,
      { reviewId, submissionVersion: input.submissionVersion },
    ),
  )
  try {
    await database.batch(statements)
  } catch (error) {
    if (isMembershipMutationConflict(error)) return { ok: false, reason: 'conflict' }
    throw error
  }
  const reviewed = await membershipApplicationById(database, input.applicationId)
  if (!reviewed) throw new Error('Reviewed membership application disappeared')
  return { ok: true, application: membershipSnapshot(reviewed), membershipId }
}

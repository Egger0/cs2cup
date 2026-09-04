import 'server-only'

import { createOpaqueToken } from '../opaque-token.ts'
import { membershipSnapshot } from './internal/membership-command.ts'
import { normalizeMembershipTransferReason } from './internal/membership-policy.ts'
import {
  reviewerAuthorizationFailure,
  reviewerSecurityEvent,
} from './internal/membership-reviewer.ts'
import {
  isMembershipMutationConflict,
  membershipApplicationById,
  membershipOperation,
  validApplicationReference,
  type MembershipOperationOptions,
} from './internal/membership-store.ts'
import {
  OPAQUE_ID,
  type AuthenticatedAuthContext,
  type IdentityDatabase,
} from './internal/contracts.ts'

export async function offerMembershipReviewTransfer(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  input: {
    readonly applicationId: string
    readonly revision: number
    readonly targetReviewerAccountId: string
    readonly reason: string
  },
  options: MembershipOperationOptions = {},
) {
  const current = membershipOperation(options)
  const reason = normalizeMembershipTransferReason(input.reason)
  if (
    !validApplicationReference(input.applicationId, input.revision) ||
    !OPAQUE_ID.test(input.targetReviewerAccountId) ||
    input.targetReviewerAccountId === context.account.id ||
    !reason.ok
  ) {
    return { ok: false, reason: 'invalid_input' } as const
  }
  const denied = await reviewerAuthorizationFailure(database, context, current.now)
  if (denied) return { ok: false, reason: denied } as const
  const application = await membershipApplicationById(database, input.applicationId)
  if (!application) return { ok: false, reason: 'not_found' } as const
  if (application.revision !== input.revision) return { ok: false, reason: 'conflict' } as const
  if (
    application.status !== 'in_review' ||
    application.assigned_reviewer_account_id !== context.account.id ||
    application.account_id === input.targetReviewerAccountId
  ) {
    return { ok: false, reason: 'invalid_state' } as const
  }
  const target = await database
    .prepare(
      `SELECT account.display_name
       FROM identity_account AS account
       JOIN identity_role_assignment AS role ON role.account_id = account.id
       WHERE account.id = ? AND account.status = 'active'
         AND role.scope_type = 'platform'
         AND role.role IN ('identity_reviewer', 'platform_owner')
         AND role.revoked_at IS NULL AND role.granted_at <= ?
         AND (role.expires_at IS NULL OR role.expires_at > ?)
       LIMIT 1`,
    )
    .bind(input.targetReviewerAccountId, current.now, current.now)
    .first<{ display_name: string }>()
  if (!target) return { ok: false, reason: 'invalid_target' } as const
  const transferId = createOpaqueToken()
  try {
    await database.batch([
      database
        .prepare(
          `INSERT INTO identity_membership_review_transfer
            (id, application_id, from_reviewer_account_id, from_reviewer_session_id,
             to_reviewer_account_id, reason, created_at, request_correlation_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          transferId,
          application.id,
          context.account.id,
          context.session.id,
          input.targetReviewerAccountId,
          reason.ok ? reason.value : '',
          current.now,
          current.correlationId,
        ),
      await reviewerSecurityEvent(
        database,
        context,
        application,
        'membership.application.transfer_offered',
        current,
        {
          transferId,
          targetReviewerAccountId: input.targetReviewerAccountId,
          reason: reason.ok ? reason.value : '',
        },
      ),
    ])
  } catch (error) {
    if (isMembershipMutationConflict(error)) return { ok: false, reason: 'conflict' } as const
    throw error
  }
  return {
    ok: true,
    transfer: {
      id: transferId,
      targetReviewerAccountId: input.targetReviewerAccountId,
      targetReviewerDisplayName: target.display_name,
      createdAt: current.now,
    },
  } as const
}

export async function acceptMembershipReviewTransfer(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  input: { readonly applicationId: string; readonly revision: number; readonly transferId: string },
  options: MembershipOperationOptions = {},
) {
  const current = membershipOperation(options)
  if (
    !validApplicationReference(input.applicationId, input.revision) ||
    !OPAQUE_ID.test(input.transferId)
  ) {
    return { ok: false, reason: 'invalid_input' } as const
  }
  const denied = await reviewerAuthorizationFailure(database, context, current.now)
  if (denied) return { ok: false, reason: denied } as const
  const [application, transfer] = await Promise.all([
    membershipApplicationById(database, input.applicationId),
    database
      .prepare(
        `SELECT from_reviewer_account_id, to_reviewer_account_id, created_at
         FROM identity_membership_review_transfer
         WHERE id = ? AND application_id = ? LIMIT 1`,
      )
      .bind(input.transferId, input.applicationId)
      .first<{
        from_reviewer_account_id: string
        to_reviewer_account_id: string
        created_at: number
      }>(),
  ])
  if (!application || !transfer) return { ok: false, reason: 'not_found' } as const
  if (application.revision !== input.revision) return { ok: false, reason: 'conflict' } as const
  if (
    application.status !== 'in_review' ||
    transfer.to_reviewer_account_id !== context.account.id ||
    transfer.from_reviewer_account_id !== application.assigned_reviewer_account_id ||
    transfer.created_at < (application.review_started_at ?? 0)
  ) {
    return { ok: false, reason: 'invalid_state' } as const
  }
  try {
    await database.batch([
      database
        .prepare(
          `UPDATE identity_membership_application
           SET assigned_reviewer_account_id = ?, assigned_reviewer_session_id = ?,
               review_started_at = ?, updated_at = ?, revision = ?, write_nonce = ?
           WHERE id = ?`,
        )
        .bind(
          context.account.id,
          context.session.id,
          current.now,
          current.now,
          input.revision + 1,
          createOpaqueToken(),
          application.id,
        ),
      await reviewerSecurityEvent(
        database,
        context,
        application,
        'membership.application.transfer_accepted',
        current,
        { transferId: input.transferId, fromReviewerAccountId: transfer.from_reviewer_account_id },
      ),
    ])
  } catch (error) {
    if (isMembershipMutationConflict(error)) return { ok: false, reason: 'conflict' } as const
    throw error
  }
  const accepted = await membershipApplicationById(database, application.id)
  if (!accepted) throw new Error('Transferred membership application disappeared')
  return { ok: true, application: membershipSnapshot(accepted) } as const
}

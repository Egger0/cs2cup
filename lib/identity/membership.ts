import 'server-only'

import { createOpaqueToken } from '../opaque-token.ts'
import type { AuthenticatedAuthContext, IdentityDatabase } from './internal/contracts.ts'
import {
  applicantSecurityEvent,
  completedMembershipApplication,
  existingApplicationForMutation,
  membershipSnapshot,
  type MembershipApplicationSnapshot,
  type MembershipMutationResult,
} from './internal/membership-command.ts'
import {
  applicationSelect,
  currentApplicantSession,
  isMembershipMutationConflict,
  membershipOperation,
  type MembershipApplicationRow,
  type MembershipOperationOptions,
} from './internal/membership-store.ts'
import {
  normalizeMembershipApplicationFields,
  type MembershipApplicationFields,
} from './internal/membership-policy.ts'

export type { MembershipApplicationSnapshot, MembershipMutationResult }

export async function getMembershipState(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  options: Pick<MembershipOperationOptions, 'now'> = {},
) {
  const { now } = membershipOperation(options)
  if (!(await currentApplicantSession(database, context, now))) {
    return { ok: false, reason: 'session_invalid' } as const
  }
  const application = await database
    .prepare(
      `SELECT ${applicationSelect()} FROM identity_membership_application
       WHERE account_id = ?
       ORDER BY CASE WHEN status IN ('draft','pending','in_review','changes_requested')
         THEN 0 ELSE 1 END, created_at DESC LIMIT 1`,
    )
    .bind(context.account.id)
    .first<MembershipApplicationRow>()
  const membership = await database
    .prepare(
      `SELECT id, status, approved_at, revoked_at FROM identity_membership
       WHERE account_id = ? LIMIT 1`,
    )
    .bind(context.account.id)
    .first<{
      id: string
      status: 'approved' | 'suspended' | 'revoked'
      approved_at: number
      revoked_at: number | null
    }>()
  return {
    ok: true,
    accountId: context.account.id,
    application: application ? membershipSnapshot(application) : null,
    membership: membership
      ? {
          id: membership.id,
          status: membership.status,
          approvedAt: membership.approved_at,
          revokedAt: membership.revoked_at,
        }
      : null,
  } as const
}

export async function createMembershipDraft(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  fields: MembershipApplicationFields = {},
  options: MembershipOperationOptions = {},
): Promise<MembershipMutationResult> {
  const normalized = normalizeMembershipApplicationFields(fields)
  if (!normalized.ok) {
    return {
      ok: false,
      reason: 'invalid_input',
      issue: { field: normalized.field, reason: normalized.reason },
    }
  }
  const operation = membershipOperation(options)
  if (!(await currentApplicantSession(database, context, operation.now))) {
    return { ok: false, reason: 'session_invalid' }
  }
  const applicationId = createOpaqueToken()
  try {
    await database.batch([
      database
        .prepare(
          `INSERT INTO identity_membership_application
            (id, account_id, identity_claim, contact, application_reason,
             last_applicant_update_at, last_applicant_session_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          applicationId,
          context.account.id,
          normalized.value.identityClaim,
          normalized.value.contact,
          normalized.value.applicationReason,
          operation.now,
          context.session.id,
          operation.now,
          operation.now,
        ),
      await applicantSecurityEvent(
        database,
        context,
        applicationId,
        'membership.application.created',
        operation,
      ),
    ])
  } catch (error) {
    if (isMembershipMutationConflict(error)) return { ok: false, reason: 'conflict' }
    throw error
  }
  return completedMembershipApplication(database, context, applicationId)
}

export async function saveMembershipDraft(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  input: MembershipApplicationFields & {
    readonly applicationId: string
    readonly revision: number
  },
  options: MembershipOperationOptions = {},
): Promise<MembershipMutationResult> {
  const normalized = normalizeMembershipApplicationFields(input)
  if (!normalized.ok) {
    return {
      ok: false,
      reason: 'invalid_input',
      issue: { field: normalized.field, reason: normalized.reason },
    }
  }
  const operation = membershipOperation(options)
  const existing = await existingApplicationForMutation(
    database,
    context,
    input.applicationId,
    input.revision,
    operation.now,
  )
  if (!existing.ok) return { ok: false, reason: existing.reason }
  if (!['draft', 'pending', 'changes_requested'].includes(existing.application.status)) {
    return { ok: false, reason: 'invalid_state' }
  }
  const previousStatus = existing.application.status
  const reopeningSubmittedDraft = previousStatus !== 'draft'
  const writeNonce = createOpaqueToken()
  const transition = reopeningSubmittedDraft
    ? `status = 'draft', submission_digest = NULL, submitted_at = NULL,
       assigned_reviewer_account_id = NULL, assigned_reviewer_session_id = NULL,
       review_started_at = NULL,`
    : ''
  try {
    // The retained row is targeted by immutable id/account without a revision predicate so a
    // stale supplied revision reaches the DB trigger and aborts the whole audit batch.
    await database.batch([
      database
        .prepare(
          `UPDATE identity_membership_application SET ${transition}
             identity_claim = ?, contact = ?, application_reason = ?,
             last_applicant_update_at = ?, last_applicant_session_id = ?, updated_at = ?,
             revision = ?, write_nonce = ? WHERE id = ? AND account_id = ?`,
        )
        .bind(
          normalized.value.identityClaim,
          normalized.value.contact,
          normalized.value.applicationReason,
          operation.now,
          context.session.id,
          operation.now,
          input.revision + 1,
          writeNonce,
          input.applicationId,
          context.account.id,
        ),
      await applicantSecurityEvent(
        database,
        context,
        input.applicationId,
        'membership.application.draft_saved',
        operation,
        { previousStatus },
      ),
    ])
  } catch (error) {
    if (isMembershipMutationConflict(error)) return { ok: false, reason: 'conflict' }
    throw error
  }
  return completedMembershipApplication(database, context, input.applicationId)
}

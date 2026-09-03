import 'server-only'

import { createOpaqueToken } from '../opaque-token.ts'
import type { AuthenticatedAuthContext, IdentityDatabase } from './internal/contracts.ts'
import {
  applicantSecurityEvent,
  completedMembershipApplication,
  existingApplicationForMutation,
  type MembershipMutationResult,
} from './internal/membership-command.ts'
import {
  isMembershipMutationConflict,
  membershipOperation,
  type MembershipApplicationRow,
  type MembershipOperationOptions,
} from './internal/membership-store.ts'
import {
  membershipFieldsAreSubmittable,
  membershipSubmissionDigest,
  normalizeMembershipApplicationFields,
  type MembershipApplicationFields,
} from './internal/membership-policy.ts'

async function submitFrom(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  application: MembershipApplicationRow,
  fields: MembershipApplicationFields | null,
  operation: { now: number; correlationId: string },
): Promise<MembershipMutationResult> {
  const normalized = normalizeMembershipApplicationFields(
    fields ?? {
      identityClaim: application.identity_claim,
      contact: application.contact,
      applicationReason: application.application_reason,
    },
  )
  if (!normalized.ok) {
    return {
      ok: false,
      reason: 'invalid_input',
      issue: { field: normalized.field, reason: normalized.reason },
    }
  }
  if (!membershipFieldsAreSubmittable(normalized.value)) return { ok: false, reason: 'incomplete' }
  const digest = await membershipSubmissionDigest(normalized.value)
  const nextVersion = application.submission_version + 1
  try {
    // Do not turn a stale revision into a silent zero-row UPDATE: the immutable retained id makes
    // the row hit the revision trigger, which rolls back this command and its security event.
    await database.batch([
      database
        .prepare(
          `UPDATE identity_membership_application
           SET identity_claim = ?, contact = ?, application_reason = ?, status = 'pending',
               submission_version = ?, submission_digest = ?, submitted_at = ?,
               assigned_reviewer_account_id = NULL, assigned_reviewer_session_id = NULL,
               review_started_at = NULL, last_applicant_update_at = ?,
               last_applicant_session_id = ?, updated_at = ?, revision = ?, write_nonce = ?
           WHERE id = ? AND account_id = ?`,
        )
        .bind(
          normalized.value.identityClaim,
          normalized.value.contact,
          normalized.value.applicationReason,
          nextVersion,
          digest,
          operation.now,
          operation.now,
          context.session.id,
          operation.now,
          application.revision + 1,
          createOpaqueToken(),
          application.id,
          context.account.id,
        ),
      await applicantSecurityEvent(
        database,
        context,
        application.id,
        'membership.application.submitted',
        operation,
        { submissionVersion: nextVersion, submissionDigest: digest },
      ),
    ])
  } catch (error) {
    if (isMembershipMutationConflict(error)) return { ok: false, reason: 'conflict' }
    throw error
  }
  return completedMembershipApplication(database, context, application.id)
}

export async function submitMembershipApplication(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  input: { readonly applicationId: string; readonly revision: number },
  options: MembershipOperationOptions = {},
): Promise<MembershipMutationResult> {
  const operation = membershipOperation(options)
  const existing = await existingApplicationForMutation(
    database,
    context,
    input.applicationId,
    input.revision,
    operation.now,
  )
  if (!existing.ok) return { ok: false, reason: existing.reason }
  if (existing.application.status !== 'draft') return { ok: false, reason: 'invalid_state' }
  return submitFrom(database, context, existing.application, null, operation)
}

export async function resubmitMembershipApplication(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  input: MembershipApplicationFields & {
    readonly applicationId: string
    readonly revision: number
  },
  options: MembershipOperationOptions = {},
): Promise<MembershipMutationResult> {
  const operation = membershipOperation(options)
  const existing = await existingApplicationForMutation(
    database,
    context,
    input.applicationId,
    input.revision,
    operation.now,
  )
  if (!existing.ok) return { ok: false, reason: existing.reason }
  if (existing.application.status !== 'changes_requested') {
    return { ok: false, reason: 'invalid_state' }
  }
  return submitFrom(database, context, existing.application, input, operation)
}

export async function withdrawMembershipApplication(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  input: { readonly applicationId: string; readonly revision: number },
  options: MembershipOperationOptions = {},
): Promise<MembershipMutationResult> {
  const operation = membershipOperation(options)
  const existing = await existingApplicationForMutation(
    database,
    context,
    input.applicationId,
    input.revision,
    operation.now,
  )
  if (!existing.ok) return { ok: false, reason: existing.reason }
  if (
    !['draft', 'pending', 'in_review', 'changes_requested'].includes(existing.application.status)
  ) {
    return { ok: false, reason: 'invalid_state' }
  }
  try {
    await database.batch([
      database
        .prepare(
          `UPDATE identity_membership_application
           SET status = 'withdrawn', last_applicant_update_at = ?,
               last_applicant_session_id = ?, updated_at = ?, revision = ?, write_nonce = ?
           WHERE id = ? AND account_id = ?`,
        )
        .bind(
          operation.now,
          context.session.id,
          operation.now,
          input.revision + 1,
          createOpaqueToken(),
          input.applicationId,
          context.account.id,
        ),
      await applicantSecurityEvent(
        database,
        context,
        input.applicationId,
        'membership.application.withdrawn',
        operation,
        { previousStatus: existing.application.status },
      ),
    ])
  } catch (error) {
    if (isMembershipMutationConflict(error)) return { ok: false, reason: 'conflict' }
    throw error
  }
  return completedMembershipApplication(database, context, input.applicationId)
}

export type { MembershipApplicationFields, MembershipMutationResult }

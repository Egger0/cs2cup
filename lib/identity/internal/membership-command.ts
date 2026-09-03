import 'server-only'

import type { AuthenticatedAuthContext, IdentityDatabase } from './contracts.ts'
import {
  applicantApplication,
  currentApplicantSession,
  validApplicationReference,
  type MembershipApplicationRow,
} from './membership-store.ts'
import type { MembershipApplicationStatus, MembershipFieldIssue } from './membership-policy.ts'
import { securityEventStatement } from './security-event.ts'

export interface MembershipApplicationSnapshot {
  readonly id: string
  readonly accountId: string
  readonly identityClaim: string | null
  readonly contact: string | null
  readonly applicationReason: string | null
  readonly status: MembershipApplicationStatus
  readonly submissionVersion: number
  readonly submissionDigest: string | null
  readonly submittedAt: number | null
  readonly assignedReviewerAccountId: string | null
  readonly reviewStartedAt: number | null
  readonly latestReviewId: string | null
  readonly latestReviewedAt: number | null
  readonly lastApplicantUpdateAt: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly revision: number
}

export type MembershipMutationResult =
  | { readonly ok: true; readonly application: MembershipApplicationSnapshot }
  | { readonly ok: false; readonly reason: 'invalid_input'; readonly issue: MembershipFieldIssue }
  | {
      readonly ok: false
      readonly reason:
        | 'invalid_reference'
        | 'session_invalid'
        | 'not_found'
        | 'invalid_state'
        | 'incomplete'
        | 'conflict'
    }

type ExistingApplicationResult =
  | { readonly ok: true; readonly application: MembershipApplicationRow }
  | {
      readonly ok: false
      readonly reason: 'invalid_reference' | 'session_invalid' | 'not_found' | 'conflict'
    }

export function membershipSnapshot(row: MembershipApplicationRow): MembershipApplicationSnapshot {
  return {
    id: row.id,
    accountId: row.account_id,
    identityClaim: row.identity_claim,
    contact: row.contact,
    applicationReason: row.application_reason,
    status: row.status,
    submissionVersion: row.submission_version,
    submissionDigest: row.submission_digest,
    submittedAt: row.submitted_at,
    assignedReviewerAccountId: row.assigned_reviewer_account_id,
    reviewStartedAt: row.review_started_at,
    latestReviewId: row.latest_review_id,
    latestReviewedAt: row.latest_reviewed_at,
    lastApplicantUpdateAt: row.last_applicant_update_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: row.revision,
  }
}

export async function completedMembershipApplication(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  applicationId: string,
) {
  const row = await applicantApplication(database, context, applicationId)
  if (!row) throw new Error('Membership mutation did not produce an application')
  return { ok: true, application: membershipSnapshot(row) } as const
}

export async function applicantSecurityEvent(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  applicationId: string,
  event: string,
  operation: { now: number; correlationId: string },
  details: Readonly<Record<string, unknown>> = {},
  deduplicationScope = `${event}:${applicationId}:${operation.correlationId}`,
) {
  return securityEventStatement(database, {
    eventType: event,
    actor: { type: 'account', accountId: context.account.id, sessionId: context.session.id },
    targetAccountId: context.account.id,
    resource: { type: 'membership_application', id: applicationId },
    correlationId: operation.correlationId,
    deduplicationScope,
    details,
    retentionClass: 'access_control',
    createdAt: operation.now,
  })
}

export async function existingApplicationForMutation(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  applicationId: string,
  revision: number,
  now: number,
): Promise<ExistingApplicationResult> {
  if (!validApplicationReference(applicationId, revision)) {
    return { ok: false, reason: 'invalid_reference' }
  }
  if (!(await currentApplicantSession(database, context, now))) {
    return { ok: false, reason: 'session_invalid' }
  }
  const application = await applicantApplication(database, context, applicationId)
  if (!application) return { ok: false, reason: 'not_found' }
  if (application.revision !== revision) return { ok: false, reason: 'conflict' }
  return { ok: true, application }
}

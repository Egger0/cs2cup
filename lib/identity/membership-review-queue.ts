import 'server-only'

import {
  OPAQUE_ID,
  type AuthenticatedAuthContext,
  type IdentityDatabase,
} from './internal/contracts.ts'
import {
  applicantSecurityEvent,
  membershipSnapshot,
  type MembershipApplicationSnapshot,
} from './internal/membership-command.ts'
import { reviewerAuthorizationFailure } from './internal/membership-reviewer.ts'
import {
  applicantApplication,
  currentApplicantSession,
  isMembershipMutationConflict,
  membershipOperation,
  type MembershipApplicationRow,
  type MembershipOperationOptions,
} from './internal/membership-store.ts'
import {
  MEMBERSHIP_REMINDER_COOLDOWN_MS,
  MEMBERSHIP_REVIEW_OVERDUE_MS,
  isMembershipReminderEligible,
  isMembershipReviewOverdue,
} from './internal/membership-policy.ts'

export interface MembershipReviewQueueItem extends MembershipApplicationSnapshot {
  readonly applicantDisplayName: string
  readonly lastReminderAt: number | null
  readonly overdue: boolean
  readonly reminderEligible: boolean
}

interface QueueRow extends MembershipApplicationRow {
  applicant_display_name: string
  last_reminder_at: number | null
}

export async function listMembershipReviewQueue(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  options: MembershipOperationOptions & { readonly limit?: number } = {},
) {
  const operation = membershipOperation(options)
  const limit = options.limit ?? 50
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return { ok: false, reason: 'invalid_input' } as const
  }
  const denied = await reviewerAuthorizationFailure(database, context, operation.now)
  if (denied) return { ok: false, reason: denied } as const
  const { results } = await database
    .prepare(
      `SELECT application.*, applicant.display_name AS applicant_display_name,
              MAX(reminder.created_at) AS last_reminder_at
       FROM identity_membership_application AS application
       JOIN identity_account AS applicant ON applicant.id = application.account_id
       LEFT JOIN identity_security_event AS reminder
         ON reminder.resource_type = 'membership_application'
        AND reminder.resource_id = application.id
        AND reminder.event_type = 'membership.application.review_reminder'
       WHERE application.status IN ('pending', 'in_review')
       GROUP BY application.id
       ORDER BY CASE WHEN application.submitted_at <= ? THEN 0 ELSE 1 END,
                CASE application.status WHEN 'pending' THEN 0 ELSE 1 END,
                application.submitted_at, application.id
       LIMIT ?`,
    )
    .bind(operation.now - MEMBERSHIP_REVIEW_OVERDUE_MS, limit)
    .all<QueueRow>()
  return {
    ok: true,
    applications: results.map(row => ({
      ...membershipSnapshot(row),
      applicantDisplayName: row.applicant_display_name,
      lastReminderAt: row.last_reminder_at,
      overdue: isMembershipReviewOverdue(
        { status: row.status, submittedAt: row.submitted_at },
        operation.now,
      ),
      reminderEligible: isMembershipReminderEligible(
        { status: row.status, submittedAt: row.submitted_at },
        row.last_reminder_at,
        operation.now,
      ),
    })),
  } as const
}

export async function recordMembershipReviewReminder(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  applicationId: string,
  options: MembershipOperationOptions = {},
) {
  const operation = membershipOperation(options)
  if (!OPAQUE_ID.test(applicationId)) return { ok: false, reason: 'invalid_input' } as const
  if (!(await currentApplicantSession(database, context, operation.now))) {
    return { ok: false, reason: 'session_invalid' } as const
  }
  const application = await applicantApplication(database, context, applicationId)
  if (!application) return { ok: false, reason: 'not_found' } as const
  const last = await database
    .prepare(
      `SELECT MAX(created_at) AS last_reminder_at FROM identity_security_event
       WHERE event_type = 'membership.application.review_reminder'
         AND resource_type = 'membership_application' AND resource_id = ?`,
    )
    .bind(applicationId)
    .first<{ last_reminder_at: number | null }>()
  const lastReminderAt = last?.last_reminder_at ?? null
  if (
    !isMembershipReminderEligible(
      { status: application.status, submittedAt: application.submitted_at },
      lastReminderAt,
      operation.now,
    )
  ) {
    return { ok: false, reason: 'not_eligible' } as const
  }
  try {
    await (
      await applicantSecurityEvent(
        database,
        context,
        application.id,
        'membership.application.review_reminder',
        operation,
        {},
        `membership-reminder:${applicationId}:${lastReminderAt ?? 'none'}`,
      )
    ).run()
  } catch (error) {
    if (isMembershipMutationConflict(error)) return { ok: false, reason: 'conflict' } as const
    throw error
  }
  return { ok: true, nextEligibleAt: operation.now + MEMBERSHIP_REMINDER_COOLDOWN_MS } as const
}

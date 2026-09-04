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
import {
  membershipReviewDetails,
  type MembershipReviewHistoryItem,
  type MembershipReviewTransfer,
} from './membership-review-history.ts'

export interface MembershipReviewQueueItem extends MembershipApplicationSnapshot {
  readonly applicantDisplayName: string
  readonly lastReminderAt: number | null
  readonly overdue: boolean
  readonly reminderEligible: boolean
  readonly deadlineRisk: boolean
  readonly history: readonly MembershipReviewHistoryItem[]
  readonly transfers: readonly MembershipReviewTransfer[]
}

export interface MembershipQueueReviewer {
  readonly accountId: string
  readonly displayName: string
}

interface QueueRow extends MembershipApplicationRow {
  applicant_display_name: string
  last_reminder_at: number | null
  deadline_at: number | null
}

interface SummaryRow {
  total_count: number
  overdue_count: number
  assigned_to_me_count: number
  oldest_submitted_at: number | null
  deadline_at: number | null
}

const MEMBERSHIP_DEADLINE_RISK_MS = 72 * 60 * 60 * 1000

function deadlineRisk(deadlineAt: number | null, now: number) {
  return deadlineAt !== null && deadlineAt > now && deadlineAt <= now + MEMBERSHIP_DEADLINE_RISK_MS
}

export async function listMembershipReviewQueue(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  options: MembershipOperationOptions & { readonly limit?: number; readonly offset?: number } = {},
) {
  const operation = membershipOperation(options)
  const limit = options.limit ?? 20
  const offset = options.offset ?? 0
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  ) {
    return { ok: false, reason: 'invalid_input' } as const
  }
  const denied = await reviewerAuthorizationFailure(database, context, operation.now)
  if (denied) return { ok: false, reason: denied } as const
  const summary = await database
    .prepare(
      `WITH next_deadline AS (
         SELECT MIN(unixepoch(reg_deadline) * 1000) AS deadline_at
         FROM tournament
         WHERE status IN ('registration', 'postponed') AND reg_deadline IS NOT NULL
           AND unixepoch(reg_deadline) * 1000 > ?
       )
       SELECT COUNT(application.id) AS total_count,
              COALESCE(SUM(application.submitted_at <= ?), 0) AS overdue_count,
              COALESCE(SUM(application.assigned_reviewer_account_id = ?), 0)
                AS assigned_to_me_count,
              MIN(application.submitted_at) AS oldest_submitted_at,
              next_deadline.deadline_at
       FROM next_deadline
       LEFT JOIN identity_membership_application AS application
         ON application.status IN ('pending', 'in_review')`,
    )
    .bind(operation.now, operation.now - MEMBERSHIP_REVIEW_OVERDUE_MS, context.account.id)
    .first<SummaryRow>()
  const { results } = await database
    .prepare(
      `WITH next_deadline AS (
         SELECT MIN(unixepoch(reg_deadline) * 1000) AS deadline_at
         FROM tournament
         WHERE status IN ('registration', 'postponed') AND reg_deadline IS NOT NULL
           AND unixepoch(reg_deadline) * 1000 > ?
       )
       SELECT application.*, applicant.display_name AS applicant_display_name,
              MAX(reminder.created_at) AS last_reminder_at, next_deadline.deadline_at
       FROM identity_membership_application AS application
       JOIN identity_account AS applicant ON applicant.id = application.account_id
       CROSS JOIN next_deadline
       LEFT JOIN identity_security_event AS reminder
         ON reminder.resource_type = 'membership_application'
        AND reminder.resource_id = application.id
        AND reminder.event_type = 'membership.application.review_reminder'
       WHERE application.status IN ('pending', 'in_review')
       GROUP BY application.id
       ORDER BY CASE WHEN next_deadline.deadline_at <= ? THEN 0 ELSE 1 END,
                CASE WHEN application.submitted_at <= ? THEN 0 ELSE 1 END,
                CASE application.status WHEN 'pending' THEN 0 ELSE 1 END,
                application.submitted_at, application.id
       LIMIT ? OFFSET ?`,
    )
    .bind(
      operation.now,
      operation.now + MEMBERSHIP_DEADLINE_RISK_MS,
      operation.now - MEMBERSHIP_REVIEW_OVERDUE_MS,
      limit,
      offset,
    )
    .all<QueueRow>()
  const { histories, transfers } = await membershipReviewDetails(
    database,
    results.map(row => row.id),
  )
  const { results: reviewerRows } = await database
    .prepare(
      `SELECT account.id, account.display_name
       FROM identity_account AS account
       JOIN identity_role_assignment AS role ON role.account_id = account.id
       WHERE account.status = 'active' AND role.scope_type = 'platform'
         AND role.role IN ('identity_reviewer', 'platform_owner')
         AND role.revoked_at IS NULL AND role.granted_at <= ?
         AND (role.expires_at IS NULL OR role.expires_at > ?)
       GROUP BY account.id, account.display_name
       ORDER BY account.display_name, account.id LIMIT 100`,
    )
    .bind(operation.now, operation.now)
    .all<{ id: string; display_name: string }>()
  const total = Number(summary?.total_count) || 0
  const deadlineAt = summary?.deadline_at ?? null
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
      deadlineRisk: deadlineRisk(row.deadline_at, operation.now),
      history: histories.get(row.id) ?? [],
      transfers: transfers.get(row.id) ?? [],
    })),
    reviewers: reviewerRows.map(row => ({
      accountId: row.id,
      displayName: row.display_name,
    })),
    summary: {
      total,
      overdue: Number(summary?.overdue_count) || 0,
      assignedToMe: Number(summary?.assigned_to_me_count) || 0,
      oldestSubmittedAt: summary?.oldest_submitted_at ?? null,
      deadlineRisk: deadlineRisk(deadlineAt, operation.now) ? total : 0,
      nearestDeadlineAt: deadlineAt,
    },
    pagination: {
      offset,
      limit,
      hasPrevious: offset > 0,
      hasNext: offset + results.length < total,
    },
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

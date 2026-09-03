import 'server-only'

import type { AuthenticatedAuthContext, IdentityDatabase } from './internal/contracts.ts'

export type MembershipApplicationState =
  | 'draft'
  | 'pending'
  | 'in_review'
  | 'changes_requested'
  | 'approved'
  | 'rejected'
  | 'withdrawn'

export interface AccountOverview {
  readonly account: { id: string; displayName: string; username: string | null }
  readonly membership: {
    status: 'approved' | 'revoked' | null
    application: {
      id: string
      identityClaim: string | null
      contact: string | null
      reason: string | null
      status: MembershipApplicationState
      submittedAt: number | null
      updatedAt: number
      revision: number
      latestReviewReason: string | null
    } | null
  }
  readonly security: { activePasskeys: number; activeSessions: number }
  readonly hasWorkAccess: boolean
}

interface OverviewRow {
  id: string
  display_name: string
  username: string | null
  membership_status: 'approved' | 'revoked' | null
  application_id: string | null
  identity_claim: string | null
  contact: string | null
  application_reason: string | null
  application_status: MembershipApplicationState | null
  submitted_at: number | null
  application_updated_at: number | null
  application_revision: number | null
  latest_review_reason: string | null
  active_passkeys: number
  active_sessions: number
  has_work_access: number
}

const APPLICATION_STATES = new Set<MembershipApplicationState>([
  'draft',
  'pending',
  'in_review',
  'changes_requested',
  'approved',
  'rejected',
  'withdrawn',
])

export async function accountOverview(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  now = Date.now(),
): Promise<AccountOverview | null> {
  const row = await database
    .prepare(
      `SELECT account.id, account.display_name, password.username,
              membership.status AS membership_status,
              application.id AS application_id,
              application.identity_claim, application.contact,
              application.application_reason, application.status AS application_status,
              application.submitted_at,
              application.updated_at AS application_updated_at,
              application.revision AS application_revision,
              review.reason AS latest_review_reason,
              (SELECT COUNT(*) FROM identity_passkey_credential AS passkey
               WHERE passkey.account_id = account.id AND passkey.status = 'active') AS active_passkeys,
              (SELECT COUNT(*) FROM identity_session AS active_session
               WHERE active_session.account_id = account.id AND active_session.revoked_at IS NULL
                 AND active_session.idle_expires_at > ? AND active_session.absolute_expires_at > ?) AS active_sessions,
              EXISTS(
                SELECT 1 FROM identity_role_assignment AS assignment
                WHERE assignment.account_id = account.id AND assignment.revoked_at IS NULL
                  AND assignment.granted_at <= ?
                  AND (assignment.expires_at IS NULL OR assignment.expires_at > ?)
              ) AS has_work_access
       FROM identity_account AS account
       LEFT JOIN identity_password_credential AS password
         ON password.account_id = account.id AND password.status = 'active'
       LEFT JOIN identity_membership AS membership ON membership.account_id = account.id
       LEFT JOIN identity_membership_application AS application ON application.id = (
         SELECT candidate.id FROM identity_membership_application AS candidate
         WHERE candidate.account_id = account.id
         ORDER BY candidate.created_at DESC LIMIT 1
       )
       LEFT JOIN identity_membership_review AS review ON review.id = application.latest_review_id
       WHERE account.id = ? AND account.status = 'active' LIMIT 1`,
    )
    .bind(now, now, now, now, context.account.id)
    .first<OverviewRow>()
  if (!row || row.id !== context.account.id) return null
  const application =
    row.application_id &&
    row.application_status &&
    APPLICATION_STATES.has(row.application_status) &&
    row.application_updated_at !== null &&
    row.application_revision !== null
      ? {
          id: row.application_id,
          identityClaim: row.identity_claim,
          contact: row.contact,
          reason: row.application_reason,
          status: row.application_status,
          submittedAt: row.submitted_at,
          updatedAt: row.application_updated_at,
          revision: row.application_revision,
          latestReviewReason: row.latest_review_reason,
        }
      : null
  return {
    account: { id: row.id, displayName: row.display_name, username: row.username },
    membership: { status: row.membership_status, application },
    security: {
      activePasskeys: Number(row.active_passkeys) || 0,
      activeSessions: Number(row.active_sessions) || 0,
    },
    hasWorkAccess: row.has_work_access === 1,
  }
}

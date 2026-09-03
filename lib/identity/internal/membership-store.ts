import 'server-only'

import { createOpaqueToken } from '../../opaque-token.ts'
import {
  OPAQUE_ID,
  validTimestamp,
  type AuthenticatedAuthContext,
  type IdentityDatabase,
} from './contracts.ts'
import type { MembershipApplicationStatus } from './membership-policy.ts'

export interface MembershipApplicationRow {
  id: string
  account_id: string
  identity_claim: string | null
  contact: string | null
  application_reason: string | null
  status: MembershipApplicationStatus
  submission_version: number
  submission_digest: string | null
  submitted_at: number | null
  assigned_reviewer_account_id: string | null
  review_started_at: number | null
  latest_review_id: string | null
  latest_reviewed_at: number | null
  last_applicant_update_at: number
  created_at: number
  updated_at: number
  revision: number
}

export interface MembershipOperationOptions {
  readonly now?: number
  readonly correlationId?: string
}

export function membershipOperation(options: MembershipOperationOptions = {}) {
  const now = options.now ?? Date.now()
  const correlationId = options.correlationId ?? createOpaqueToken()
  if (!validTimestamp(now) || !/^[A-Za-z0-9_.:-]{16,128}$/.test(correlationId)) {
    throw new TypeError('Invalid membership operation metadata')
  }
  return { now, correlationId }
}

export function validApplicationReference(applicationId: string, revision: number) {
  return OPAQUE_ID.test(applicationId) && Number.isSafeInteger(revision) && revision >= 0
}

export async function currentApplicantSession(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  now: number,
) {
  const row = await database
    .prepare(
      `SELECT 1 AS current
       FROM identity_account AS account
       JOIN identity_session AS session
         ON session.id = ? AND session.account_id = account.id
       WHERE account.id = ? AND account.status = 'active'
         AND account.security_version = session.security_version
         AND session.revoked_at IS NULL AND session.recovery_restricted = 0
         AND session.created_at <= ? AND session.idle_expires_at > ?
         AND session.absolute_expires_at > ?
       LIMIT 1`,
    )
    .bind(context.session.id, context.account.id, now, now, now)
    .first<{ current: number }>()
  return row?.current === 1
}

export function applicationSelect() {
  return `id, account_id, identity_claim, contact, application_reason, status,
          submission_version, submission_digest, submitted_at,
          assigned_reviewer_account_id, review_started_at, latest_review_id,
          latest_reviewed_at, last_applicant_update_at, created_at, updated_at, revision`
}

export async function applicantApplication(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  applicationId: string,
) {
  return database
    .prepare(
      `SELECT ${applicationSelect()} FROM identity_membership_application
       WHERE id = ? AND account_id = ? LIMIT 1`,
    )
    .bind(applicationId, context.account.id)
    .first<MembershipApplicationRow>()
}

export async function membershipApplicationById(database: IdentityDatabase, applicationId: string) {
  return database
    .prepare(
      `SELECT ${applicationSelect()} FROM identity_membership_application
       WHERE id = ? LIMIT 1`,
    )
    .bind(applicationId)
    .first<MembershipApplicationRow>()
}

export function isMembershipMutationConflict(error: unknown) {
  return (
    error instanceof Error &&
    /(?:membership|constraint|unique|foreign key|revision conflict|identity reviewer)/i.test(
      error.message,
    )
  )
}

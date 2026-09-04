import 'server-only'

import { createOpaqueToken } from '../opaque-token.ts'
import {
  OPAQUE_ID,
  type AuthenticatedAuthContext,
  type IdentityDatabase,
} from './internal/contracts.ts'
import { normalizeMembershipReviewReason } from './internal/membership-policy.ts'
import { reviewerAuthorizationFailure } from './internal/membership-reviewer.ts'
import {
  isMembershipMutationConflict,
  membershipOperation,
  type MembershipOperationOptions,
} from './internal/membership-store.ts'
import { securityEventStatement } from './internal/security-event.ts'

export interface ApprovedMembershipItem {
  readonly id: string
  readonly revision: number
  readonly accountId: string
  readonly displayName: string
  readonly username: string | null
  readonly approvedAt: number
  readonly status: 'approved' | 'suspended'
  readonly statusChangeReason: string | null
  readonly statusChangedAt: number | null
}

export async function listApprovedMemberships(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  options: MembershipOperationOptions & { readonly limit?: number; readonly offset?: number } = {},
) {
  const current = membershipOperation(options)
  const limit = options.limit ?? 50
  const offset = options.offset ?? 0
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  ) {
    return { ok: false, reason: 'invalid_input' } as const
  }
  const denied = await reviewerAuthorizationFailure(database, context, current.now)
  if (denied) return { ok: false, reason: denied } as const
  const [count, rows] = await Promise.all([
    database
      .prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(status = 'suspended'), 0) AS suspended
         FROM identity_membership WHERE status IN ('approved', 'suspended')`,
      )
      .bind()
      .first<{ total: number; suspended: number }>(),
    database
      .prepare(
        `SELECT membership.id, membership.revision, membership.account_id,
                account.display_name, password.username, membership.approved_at,
                membership.status, membership.status_change_reason,
                membership.status_changed_at
         FROM identity_membership AS membership
         JOIN identity_account AS account ON account.id = membership.account_id
         LEFT JOIN identity_password_credential AS password
           ON password.account_id = account.id AND password.status = 'active'
         WHERE membership.status IN ('approved', 'suspended')
         ORDER BY CASE membership.status WHEN 'suspended' THEN 0 ELSE 1 END,
                  membership.approved_at DESC, membership.id
         LIMIT ? OFFSET ?`,
      )
      .bind(limit, offset)
      .all<{
        id: string
        revision: number
        account_id: string
        display_name: string
        username: string | null
        approved_at: number
        status: 'approved' | 'suspended'
        status_change_reason: string | null
        status_changed_at: number | null
      }>(),
  ])
  return {
    ok: true,
    total: Number(count?.total) || 0,
    suspended: Number(count?.suspended) || 0,
    memberships: rows.results.map(row => ({
      id: row.id,
      revision: row.revision,
      accountId: row.account_id,
      displayName: row.display_name,
      username: row.username,
      approvedAt: row.approved_at,
      status: row.status,
      statusChangeReason: row.status_change_reason,
      statusChangedAt: row.status_changed_at,
    })),
    pagination: {
      offset,
      limit,
      hasPrevious: offset > 0,
      hasNext: offset + rows.results.length < (Number(count?.total) || 0),
    },
  } as const
}

export async function changeMembershipStatus(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  input: {
    readonly membershipId: string
    readonly revision: number
    readonly operation: 'suspend' | 'restore' | 'revoke'
    readonly reason: string
  },
  options: MembershipOperationOptions = {},
) {
  const current = membershipOperation(options)
  const reason = normalizeMembershipReviewReason(input.reason)
  if (
    !OPAQUE_ID.test(input.membershipId) ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 0 ||
    !['suspend', 'restore', 'revoke'].includes(input.operation) ||
    !reason.ok
  ) {
    return { ok: false, reason: 'invalid_input' } as const
  }
  const denied = await reviewerAuthorizationFailure(database, context, current.now)
  if (denied) return { ok: false, reason: denied } as const
  const membership = await database
    .prepare(
      `SELECT id, account_id, status, revision FROM identity_membership
       WHERE id = ? LIMIT 1`,
    )
    .bind(input.membershipId)
    .first<{
      id: string
      account_id: string
      status: 'approved' | 'suspended' | 'revoked'
      revision: number
    }>()
  if (!membership) return { ok: false, reason: 'not_found' } as const
  if (membership.revision !== input.revision) return { ok: false, reason: 'conflict' } as const
  const targetStatus =
    input.operation === 'suspend'
      ? 'suspended'
      : input.operation === 'restore'
        ? 'approved'
        : 'revoked'
  const validTransition =
    (membership.status === 'approved' && ['suspended', 'revoked'].includes(targetStatus)) ||
    (membership.status === 'suspended' && ['approved', 'revoked'].includes(targetStatus))
  if (!validTransition) return { ok: false, reason: 'invalid_state' } as const
  const normalizedReason = reason.ok ? reason.value : ''
  const statusEventId = createOpaqueToken()
  try {
    await database.batch([
      database
        .prepare(
          `INSERT INTO identity_membership_status_event
            (id, membership_id, from_status, to_status, actor_account_id, actor_session_id,
             reason, created_at, request_correlation_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          statusEventId,
          membership.id,
          membership.status,
          targetStatus,
          context.account.id,
          context.session.id,
          normalizedReason,
          current.now,
          current.correlationId,
        ),
      database
        .prepare(
          `UPDATE identity_membership
           SET status = ?, revoked_by_account_id = ?, revoker_session_id = ?,
               revoke_reason = ?, revoked_at = ?, status_changed_by_account_id = ?,
               status_changed_session_id = ?, status_change_reason = ?, status_changed_at = ?,
               revision = ?, write_nonce = ?
           WHERE id = ?`,
        )
        .bind(
          targetStatus,
          targetStatus === 'revoked' ? context.account.id : null,
          targetStatus === 'revoked' ? context.session.id : null,
          targetStatus === 'revoked' ? normalizedReason : null,
          targetStatus === 'revoked' ? current.now : null,
          context.account.id,
          context.session.id,
          normalizedReason,
          current.now,
          input.revision + 1,
          createOpaqueToken(),
          membership.id,
        ),
      await securityEventStatement(database, {
        eventType: `membership.access.${input.operation === 'restore' ? 'restored' : targetStatus}`,
        severity: targetStatus === 'approved' ? 'info' : 'warning',
        actor: { type: 'account', accountId: context.account.id, sessionId: context.session.id },
        targetAccountId: membership.account_id,
        resource: { type: 'membership', id: membership.id },
        correlationId: current.correlationId,
        deduplicationScope: `membership-${input.operation}:${membership.id}:${input.revision}`,
        details: { fromStatus: membership.status, toStatus: targetStatus, statusEventId },
        retentionClass: 'access_control',
        createdAt: current.now,
      }),
    ])
  } catch (error) {
    if (isMembershipMutationConflict(error)) return { ok: false, reason: 'conflict' } as const
    throw error
  }
  return { ok: true, status: targetStatus } as const
}

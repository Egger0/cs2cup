import 'server-only'

import { createOpaqueToken, hashOpaqueToken } from '../../opaque-token.ts'
import { authorize } from './authorization.ts'
import {
  validTimestamp,
  type AuthenticatedAuthContext,
  type IdentityDatabase,
} from './contracts.ts'
import { SENSITIVE_RECENT_AUTH_MAX_AGE_MS } from './policy.ts'
import { privateSessionContext } from './session-context.ts'

export type RoleOperationOptions = { readonly now?: number; readonly correlationId?: string }

export function roleOperation(options: RoleOperationOptions) {
  const now = options.now ?? Date.now()
  const correlationId = options.correlationId ?? createOpaqueToken()
  if (!validTimestamp(now) || !/^[A-Za-z0-9_.:-]{16,128}$/.test(correlationId)) {
    throw new TypeError('Invalid role operation metadata')
  }
  return { now, correlationId }
}

export async function roleAccessFailure(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  now: number,
) {
  const decision = await authorize(
    database,
    context,
    'platform.access.manage',
    { kind: 'platform' },
    undefined,
    now,
  )
  if (decision.ok) return null
  if (decision.reason === 'assurance_required') return 'reauthentication_required' as const
  if (decision.reason === 'session_invalid' || decision.reason === 'recovery_restricted') {
    return 'session_invalid' as const
  }
  return 'forbidden' as const
}

export const ACTIVE_ROLE_OPERATOR = `EXISTS (
  SELECT 1
  FROM identity_session AS operator_session
  JOIN identity_account AS operator ON operator.id = operator_session.account_id
  JOIN identity_role_assignment AS operator_role ON operator_role.account_id = operator.id
  WHERE operator_session.id = ? AND operator_session.account_id = ?
    AND operator_session.token_hash = ?
    AND operator_session.security_version = operator.security_version
    AND operator_session.revoked_at IS NULL AND operator_session.recovery_restricted = 0
    AND operator_session.auth_method != 'bootstrap' AND operator_session.created_at <= ?
    AND operator_session.authenticated_at >= ? AND operator_session.authenticated_at <= ?
    AND operator_session.idle_expires_at > ? AND operator_session.absolute_expires_at > ?
    AND operator.status = 'active'
    AND operator_role.role = 'platform_owner' AND operator_role.scope_type = 'platform'
    AND operator_role.scope_tournament_id IS NULL AND operator_role.revoked_at IS NULL
    AND operator_role.granted_at <= ?
    AND (operator_role.expires_at IS NULL OR operator_role.expires_at > ?)
)`

export function roleOperatorProof(context: AuthenticatedAuthContext, now: number) {
  const tokenHash = privateSessionContext(context)?.tokenHash
  return tokenHash
    ? [
        context.session.id,
        context.account.id,
        tokenHash,
        now,
        now - SENSITIVE_RECENT_AUTH_MAX_AGE_MS,
        now,
        now,
        now,
        now,
        now,
      ]
    : null
}

interface RoleMutationAudit {
  readonly action: 'granted' | 'revoked'
  readonly assignmentId: string
  readonly assignmentNonce: string
  readonly assignmentRevision: number
  readonly targetAccountId: string
  readonly role: string
  readonly tournamentId: number | null
  readonly reason: string
  readonly context: AuthenticatedAuthContext
  readonly correlationId: string
  readonly now: number
}

function mutationProof(input: RoleMutationAudit, alias = 'assignment') {
  const actorColumn = input.action === 'granted' ? 'granted_by_account_id' : 'revoked_by_account_id'
  const reasonColumn = input.action === 'granted' ? 'grant_reason' : 'revoke_reason'
  const timeColumn = input.action === 'granted' ? 'granted_at' : 'revoked_at'
  const status =
    input.action === 'granted' ? `${alias}.revoked_at IS NULL` : `${alias}.revoked_at = ?`
  return {
    sql: `${alias}.id = ? AND ${alias}.write_nonce = ? AND ${alias}.account_id = ?
      AND ${alias}.role = ? AND ${alias}.scope_tournament_id IS ?
      AND ${alias}.${actorColumn} = ? AND ${alias}.${reasonColumn} = ?
      AND ${alias}.${timeColumn} = ? AND ${alias}.revision = ? AND ${status}`,
    bindings: [
      input.assignmentId,
      input.assignmentNonce,
      input.targetAccountId,
      input.role,
      input.tournamentId,
      input.context.account.id,
      input.reason,
      input.now,
      input.assignmentRevision,
      ...(input.action === 'revoked' ? [input.now] : []),
    ],
  }
}

export async function roleMutationAuditStatement(
  database: IdentityDatabase,
  input: RoleMutationAudit,
) {
  const eventType = `identity.role.${input.action}`
  const proof = mutationProof(input)
  return database
    .prepare(
      `INSERT INTO identity_security_event
        (id, event_type, severity, actor_type, actor_account_id, target_account_id,
         actor_session_id, resource_type, resource_id, request_correlation_id,
         deduplication_key, details_json, retention_class, created_at)
       SELECT ?, ?, ?, 'account', ?, ?, ?, ?, ?, ?, ?, ?, 'access_control', ?
       WHERE EXISTS (
         SELECT 1 FROM identity_role_assignment AS assignment WHERE ${proof.sql}
       )`,
    )
    .bind(
      createOpaqueToken(),
      eventType,
      input.action === 'revoked' ? 'warning' : 'info',
      input.context.account.id,
      input.targetAccountId,
      input.context.session.id,
      input.tournamentId === null ? 'platform' : 'tournament',
      input.tournamentId === null ? null : String(input.tournamentId),
      input.correlationId,
      await hashOpaqueToken(
        `role-${input.action}\0${input.assignmentId}\0${input.assignmentNonce}`,
      ),
      JSON.stringify({
        assignmentId: input.assignmentId,
        role: input.role,
        reason: input.reason,
      }),
      input.now,
      ...proof.bindings,
    )
}

export async function roleMutationRecorded(database: IdentityDatabase, input: RoleMutationAudit) {
  const proof = mutationProof(input)
  const row = await database
    .prepare(
      `SELECT 1 AS recorded FROM identity_role_assignment AS assignment
       JOIN identity_security_event AS event ON event.request_correlation_id = ?
       WHERE ${proof.sql} AND event.event_type = ?
         AND event.actor_account_id = ? AND event.actor_session_id = ?
         AND event.target_account_id = ? LIMIT 1`,
    )
    .bind(
      input.correlationId,
      ...proof.bindings,
      `identity.role.${input.action}`,
      input.context.account.id,
      input.context.session.id,
      input.targetAccountId,
    )
    .first<{ recorded: number }>()
  return row?.recorded === 1
}

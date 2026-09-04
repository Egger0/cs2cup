import 'server-only'

import { createOpaqueToken, hashOpaqueToken } from '../../opaque-token.ts'
import type { AuthenticatedAuthContext, IdentityDatabase } from './contracts.ts'
import { hasRecentAuthentication, RECENT_AUTHENTICATION_MS } from './recent-authentication.ts'
import { privateSessionContext } from './session-context.ts'

const SESSION_LIMIT = 20
const SESSION_ID = /^[A-Za-z0-9_-]{43}$/

export class AccountSessionError extends Error {
  readonly code: 'not_authenticated' | 'recovery_restricted' | 'reauth_required' | 'not_found'

  constructor(code: 'not_authenticated' | 'recovery_restricted' | 'reauth_required' | 'not_found') {
    super(code)
    this.name = 'AccountSessionError'
    this.code = code
  }
}

export interface AccountSession {
  readonly id: string
  readonly current: boolean
  readonly authMethod: string
  readonly clientLabel: string | null
  readonly createdAt: number
  readonly lastSeenAt: number
  readonly idleExpiresAt: number
  readonly absoluteExpiresAt: number
}

interface SessionRow {
  id: string
  auth_method: string
  client_label: string | null
  created_at: number
  last_seen_at: number
  idle_expires_at: number
  absolute_expires_at: number
}

function privateSession(context: AuthenticatedAuthContext) {
  const value = privateSessionContext(context)
  if (!value) throw new AccountSessionError('not_authenticated')
  return value
}

function currentSessionWhere() {
  return `current.id = ? AND current.account_id = ? AND current.token_hash = ?
    AND current.revoked_at IS NULL AND current.security_version = account.security_version
    AND current.idle_expires_at > ? AND current.absolute_expires_at > ?
    AND account.status = 'active'`
}

export async function listAccountSessions(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  now = Date.now(),
) {
  if (context.session.recoveryRestricted) throw new AccountSessionError('recovery_restricted')
  const session = privateSession(context)
  const rows = await database
    .prepare(
      `SELECT candidate.id, candidate.auth_method,
              CASE WHEN json_type(candidate.display_metadata_json, '$.clientLabel') = 'text'
                THEN substr(json_extract(candidate.display_metadata_json, '$.clientLabel'), 1, 100)
                ELSE NULL END AS client_label, candidate.created_at,
              candidate.last_seen_at, candidate.idle_expires_at, candidate.absolute_expires_at
       FROM identity_session AS candidate
       JOIN identity_account AS account ON account.id = candidate.account_id
       JOIN identity_session AS current ON current.account_id = account.id
       WHERE candidate.account_id = ? AND candidate.revoked_at IS NULL
         AND candidate.idle_expires_at > ? AND candidate.absolute_expires_at > ?
         AND ${currentSessionWhere()}
       ORDER BY candidate.id = ? DESC, candidate.last_seen_at DESC, candidate.id DESC
       LIMIT ?`,
    )
    .bind(
      context.account.id,
      now,
      now,
      context.session.id,
      context.account.id,
      session.tokenHash,
      now,
      now,
      context.session.id,
      SESSION_LIMIT,
    )
    .all<SessionRow>()
  if (!rows.results.some(row => row.id === context.session.id)) {
    throw new AccountSessionError('not_authenticated')
  }
  return Object.freeze(
    rows.results.map(row =>
      Object.freeze({
        id: row.id,
        current: row.id === context.session.id,
        authMethod: row.auth_method,
        clientLabel: row.client_label,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        idleExpiresAt: row.idle_expires_at,
        absoluteExpiresAt: row.absolute_expires_at,
      }),
    ),
  )
}

function requireSessionManagement(context: AuthenticatedAuthContext, now: number) {
  const session = privateSession(context)
  if (context.session.recoveryRestricted) throw new AccountSessionError('recovery_restricted')
  if (!hasRecentAuthentication(context, now)) throw new AccountSessionError('reauth_required')
  return session
}

async function revokedSessionsEvent(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  nonce: string,
  now: number,
) {
  const correlationId = createOpaqueToken()
  return database
    .prepare(
      `INSERT INTO identity_security_event
        (id, event_type, severity, actor_type, actor_account_id, target_account_id,
         actor_session_id, resource_type, resource_id, request_correlation_id,
         deduplication_key, details_json, retention_class, created_at)
       SELECT ?, 'identity.sessions.revoked', 'warning', 'account', ?, ?, ?,
              'account', ?, ?, ?, json_object('count', matched.count),
              'account_security', ?
       FROM (
         SELECT COUNT(*) AS count FROM identity_session
         WHERE account_id = ? AND id != ? AND revoked_at = ? AND write_nonce = ?
       ) AS matched
       WHERE matched.count > 0`,
    )
    .bind(
      createOpaqueToken(),
      context.account.id,
      context.account.id,
      context.session.id,
      context.account.id,
      correlationId,
      await hashOpaqueToken(`identity.sessions.revoked\0${context.session.id}\0${correlationId}`),
      now,
      context.account.id,
      context.session.id,
      now,
      nonce,
    )
}

async function revokedSessionEvent(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  sessionId: string,
  nonce: string,
  now: number,
) {
  return database
    .prepare(
      `INSERT INTO identity_security_event
        (id, event_type, severity, actor_type, actor_account_id, target_account_id,
         actor_session_id, resource_type, resource_id, request_correlation_id,
         deduplication_key, details_json, retention_class, created_at)
       SELECT ?, 'identity.session.revoked', 'warning', 'account', ?, ?, ?, 'account', ?,
              ?, ?, ?, 'account_security', ?
       WHERE EXISTS (
         SELECT 1 FROM identity_session
         WHERE id = ? AND account_id = ? AND revoked_at = ? AND write_nonce = ?
       )`,
    )
    .bind(
      createOpaqueToken(),
      context.account.id,
      context.account.id,
      context.session.id,
      context.account.id,
      createOpaqueToken(),
      await hashOpaqueToken(`identity.session.revoked\0${sessionId}\0${now}`),
      JSON.stringify({ sessionId }),
      now,
      sessionId,
      context.account.id,
      now,
      nonce,
    )
}

export async function revokeAccountSession(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  sessionId: string,
  now = Date.now(),
) {
  if (!SESSION_ID.test(sessionId) || sessionId === context.session.id) {
    throw new AccountSessionError('not_found')
  }
  const current = requireSessionManagement(context, now)
  const nonce = createOpaqueToken()
  await database.batch([
    database
      .prepare(
        `UPDATE identity_session
         SET revoked_at = ?, revoke_reason = 'revoked_by_account',
             revision = revision + 1, write_nonce = ?
         WHERE id = ? AND account_id = ? AND revoked_at IS NULL
           AND EXISTS (
             SELECT 1 FROM identity_session AS current
             JOIN identity_account AS account ON account.id = current.account_id
             WHERE ${currentSessionWhere()}
               AND current.recovery_restricted = 0 AND current.authenticated_at >= ?
           )`,
      )
      .bind(
        now,
        nonce,
        sessionId,
        context.account.id,
        context.session.id,
        context.account.id,
        current.tokenHash,
        now,
        now,
        now - RECENT_AUTHENTICATION_MS,
      ),
    await revokedSessionEvent(database, context, sessionId, nonce, now),
  ])
  const revoked = await database
    .prepare(
      `SELECT 1 AS revoked FROM identity_session
       WHERE id = ? AND account_id = ? AND revoked_at = ? AND write_nonce = ? LIMIT 1`,
    )
    .bind(sessionId, context.account.id, now, nonce)
    .first<{ revoked: number }>()
  if (!revoked) throw new AccountSessionError('not_found')
}

export async function revokeOtherAccountSessions(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  now = Date.now(),
) {
  const current = requireSessionManagement(context, now)
  const nonce = createOpaqueToken()
  await database.batch([
    database
      .prepare(
        `UPDATE identity_session
         SET revoked_at = ?, revoke_reason = 'revoked_other_sessions',
             revision = revision + 1, write_nonce = ?
         WHERE account_id = ? AND id != ? AND revoked_at IS NULL
           AND EXISTS (
             SELECT 1 FROM identity_session AS current
             JOIN identity_account AS account ON account.id = current.account_id
             WHERE ${currentSessionWhere()}
               AND current.recovery_restricted = 0 AND current.authenticated_at >= ?
           )`,
      )
      .bind(
        now,
        nonce,
        context.account.id,
        context.session.id,
        context.session.id,
        context.account.id,
        current.tokenHash,
        now,
        now,
        now - RECENT_AUTHENTICATION_MS,
      ),
    await revokedSessionsEvent(database, context, nonce, now),
  ])
  const result = await database
    .prepare(
      `SELECT COUNT(*) AS count FROM identity_session
       WHERE account_id = ? AND id != ? AND revoked_at = ? AND write_nonce = ?`,
    )
    .bind(context.account.id, context.session.id, now, nonce)
    .first<{ count: number }>()
  return Math.max(0, Number(result?.count) || 0)
}

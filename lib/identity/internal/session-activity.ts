import 'server-only'

import { createOpaqueToken } from '../../opaque-token.ts'
import { validTimestamp, type AuthContext, type IdentityDatabase } from './contracts.ts'
import { contextWithActivity, privateSessionContext } from './session-context.ts'
import {
  RECOVERY_SESSION_IDLE_MS,
  SESSION_IDLE_MS,
  SESSION_TOUCH_INTERVAL_MS,
} from './session-draft.ts'
import { resolveAuthContextFromHash } from './session-resolution.ts'

interface ActivityRow {
  last_seen_at: number
  idle_expires_at: number
  revision: number
}

export async function touchSessionActivity(
  database: IdentityDatabase,
  context: AuthContext,
  now = Date.now(),
): Promise<AuthContext> {
  if (context.kind === 'anonymous' || !validTimestamp(now)) return { kind: 'anonymous' }
  const privateContext = privateSessionContext(context)
  if (!privateContext) return { kind: 'anonymous' }
  if (now - context.session.lastSeenAt < SESSION_TOUCH_INTERVAL_MS) return context
  const idleMs = context.session.recoveryRestricted ? RECOVERY_SESSION_IDLE_MS : SESSION_IDLE_MS
  const idleExpiresAt = Math.min(context.session.absoluteExpiresAt, now + idleMs)
  if (idleExpiresAt <= now) return { kind: 'anonymous' }
  const row = await database
    .prepare(
      `UPDATE identity_session
       SET last_seen_at = ?, idle_expires_at = ?, revision = revision + 1, write_nonce = ?
       WHERE id = ? AND account_id = ? AND token_hash = ? AND revision = ?
         AND last_seen_at = ? AND last_seen_at <= ?
         AND revoked_at IS NULL AND idle_expires_at > ? AND absolute_expires_at > ?
         AND EXISTS (
           SELECT 1 FROM identity_account AS account
           WHERE account.id = identity_session.account_id AND account.status = 'active'
             AND account.security_version = identity_session.security_version
         )
       RETURNING last_seen_at, idle_expires_at, revision`,
    )
    .bind(
      now,
      idleExpiresAt,
      createOpaqueToken(),
      context.session.id,
      context.account.id,
      privateContext.tokenHash,
      privateContext.revision,
      context.session.lastSeenAt,
      now - SESSION_TOUCH_INTERVAL_MS,
      now,
      now,
    )
    .first<ActivityRow>()
  if (!row) return resolveAuthContextFromHash(database, privateContext.tokenHash, now)
  return (
    contextWithActivity(context, row.last_seen_at, row.idle_expires_at, row.revision) ?? {
      kind: 'anonymous',
    }
  )
}

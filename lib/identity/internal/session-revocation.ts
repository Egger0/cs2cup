import 'server-only'

import { createOpaqueToken, hashOpaqueToken } from '../../opaque-token.ts'
import { validTimestamp, type AuthContext, type IdentityDatabase } from './contracts.ts'
import { sessionHashForContext } from './session-context.ts'

export async function revokeSession(
  database: IdentityDatabase,
  context: AuthContext,
  reason: string,
  now = Date.now(),
  requestCorrelationId = createOpaqueToken(),
) {
  const tokenHash = sessionHashForContext(context)
  const normalizedReason = reason.trim()
  if (
    context.kind !== 'authenticated' ||
    !tokenHash ||
    !validTimestamp(now) ||
    normalizedReason.length < 1 ||
    normalizedReason.length > 160 ||
    !/^[A-Za-z0-9_.:-]{16,128}$/.test(requestCorrelationId)
  ) {
    return false
  }
  const writeNonce = createOpaqueToken()
  const eventId = createOpaqueToken()
  const deduplicationKey = await hashOpaqueToken(createOpaqueToken())
  const update = database
    .prepare(
      `UPDATE identity_session
       SET revoked_at = ?, revoke_reason = ?, revision = revision + 1, write_nonce = ?
       WHERE id = ? AND account_id = ? AND token_hash = ? AND revoked_at IS NULL`,
    )
    .bind(now, normalizedReason, writeNonce, context.session.id, context.account.id, tokenHash)
  const audit = database
    .prepare(
      `INSERT INTO identity_security_event
        (id, event_type, severity, actor_type, actor_account_id, target_account_id,
         actor_session_id, resource_type, resource_id, request_correlation_id,
         deduplication_key, details_json, retention_class, created_at)
       SELECT ?, 'identity.session.revoked', 'info', 'account', account_id, account_id,
              id, 'account', account_id, ?, ?, ?, 'account_security', ?
       FROM identity_session
       WHERE id = ? AND account_id = ? AND token_hash = ?
         AND revoked_at = ? AND revoke_reason = ? AND write_nonce = ?`,
    )
    .bind(
      eventId,
      requestCorrelationId,
      deduplicationKey,
      JSON.stringify({ reason: normalizedReason }),
      now,
      context.session.id,
      context.account.id,
      tokenHash,
      now,
      normalizedReason,
      writeNonce,
    )
  await database.batch([update, audit])
  const event = await database
    .prepare('SELECT id FROM identity_security_event WHERE id = ? LIMIT 1')
    .bind(eventId)
    .first<{ id: string }>()
  return event?.id === eventId
}

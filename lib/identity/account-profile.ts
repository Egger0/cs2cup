import 'server-only'

import { createOpaqueToken } from '../opaque-token.ts'
import type { AuthenticatedAuthContext, IdentityDatabase } from './internal/contracts.ts'
import { evaluateDisplayName } from './internal/self-registration-policy.ts'

export type UpdateAccountProfileResult =
  | { ok: true; displayName: string }
  | { ok: false; reason: 'invalid_input' | 'session_invalid' }

export async function updateAccountDisplayName(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  displayName: string,
  now = Date.now(),
): Promise<UpdateAccountProfileResult> {
  const evaluated = evaluateDisplayName(displayName)
  if (!evaluated.ok) return { ok: false, reason: 'invalid_input' }
  const normalized = evaluated.displayName

  const writeNonce = createOpaqueToken()
  await database
    .prepare(
      `UPDATE identity_account
       SET display_name = ?, updated_at = ?, revision = revision + 1, write_nonce = ?
       WHERE id = ? AND status = 'active'
         AND EXISTS (
           SELECT 1 FROM identity_session AS session
           WHERE session.id = ? AND session.account_id = identity_account.id
             AND session.revoked_at IS NULL AND session.recovery_restricted = 0
             AND session.security_version = identity_account.security_version
             AND session.idle_expires_at > ? AND session.absolute_expires_at > ?
         )`,
    )
    .bind(normalized, now, writeNonce, context.account.id, context.session.id, now, now)
    .run()

  const updated = await database
    .prepare(
      `SELECT display_name FROM identity_account
       WHERE id = ? AND write_nonce = ? AND status = 'active' LIMIT 1`,
    )
    .bind(context.account.id, writeNonce)
    .first<{ display_name: string }>()
  return updated
    ? { ok: true, displayName: updated.display_name }
    : { ok: false, reason: 'session_invalid' }
}

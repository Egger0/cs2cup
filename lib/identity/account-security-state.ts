import 'server-only'

import type { AuthenticatedAuthContext, IdentityDatabase } from './internal/contracts.ts'
import { privateSessionContext } from './internal/session-context.ts'

export interface AccountSecurityState {
  readonly accountId: string
  readonly displayName: string
  readonly username: string | null
}

export async function accountSecurityState(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  now = Date.now(),
): Promise<AccountSecurityState | null> {
  const privateContext = privateSessionContext(context)
  if (!privateContext) return null
  const row = await database
    .prepare(
      `SELECT account.id, account.display_name, password.username
       FROM identity_session AS session
       JOIN identity_account AS account ON account.id = session.account_id
       LEFT JOIN identity_password_credential AS password
         ON password.account_id = account.id AND password.status = 'active'
       WHERE session.id = ? AND session.account_id = ? AND session.token_hash = ?
         AND session.revoked_at IS NULL AND session.security_version = account.security_version
         AND session.idle_expires_at > ? AND session.absolute_expires_at > ?
         AND account.status = 'active' LIMIT 1`,
    )
    .bind(context.session.id, context.account.id, privateContext.tokenHash, now, now)
    .first<{ id: string; display_name: string; username: string | null }>()
  return row?.id === context.account.id
    ? { accountId: row.id, displayName: row.display_name, username: row.username }
    : null
}

export async function accountHasWorkAccess(
  database: IdentityDatabase,
  accountId: string,
  now = Date.now(),
) {
  const row = await database
    .prepare(
      `SELECT 1 AS present FROM identity_role_assignment
       WHERE account_id = ? AND revoked_at IS NULL AND granted_at <= ?
         AND (expires_at IS NULL OR expires_at > ?) LIMIT 1`,
    )
    .bind(accountId, now, now)
    .first<{ present: number }>()
  return Boolean(row)
}

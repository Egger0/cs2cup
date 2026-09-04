import 'server-only'

import { cache } from 'react'
import { cookies } from 'next/headers'
import { cloudflareBindings } from './cloudflare-bindings'
import { hashOpaqueToken } from './opaque-token.ts'
import { LEGACY_ADMIN_SESSION_COOKIE } from './participant-auth'

interface LegacyAdminSessionRow {
  admin_id: number
  username: string
  expires_at: number
}

export const getCurrentLegacyAdminSessionIdentity = cache(async () => {
  const token = (await cookies()).get(LEGACY_ADMIN_SESSION_COOKIE)?.value
  if (!token) return null
  const session = await cloudflareBindings()
    .db.prepare(
      `SELECT account.id AS admin_id, account.username, session.expires_at
       FROM admin_session AS session
       JOIN admin_account AS account ON account.id = session.admin_id
       WHERE session.token_hash = ? AND session.expires_at > ?
         AND NOT EXISTS (
           SELECT 1 FROM identity_legacy_subject_map AS migrated
           WHERE migrated.subject_type = 'admin_account'
             AND migrated.subject_id = CAST(session.admin_id AS TEXT)
         )`,
    )
    .bind(await hashOpaqueToken(token), Date.now())
    .first<LegacyAdminSessionRow>()
  return session
    ? { adminId: session.admin_id, uid: session.username, sessionExpiresAt: session.expires_at }
    : null
})

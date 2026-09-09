import 'server-only'

import { createOpaqueToken } from '../opaque-token.ts'
import type { AuthenticatedAuthContext, IdentityDatabase } from './internal/contracts.ts'

export type PublicHandleRefusal = 'invalid' | 'reserved' | 'taken' | 'session_invalid'

export type PublicHandleResult =
  | { readonly ok: true; readonly handle: string | null }
  | { readonly ok: false; readonly reason: PublicHandleRefusal }

const HANDLE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/

const RESERVED = new Set([
  'about',
  'account',
  'admin',
  'api',
  'archive',
  'games',
  'guestbook',
  'login',
  'me',
  'media',
  'news',
  'players',
  'recover',
  'register',
  'search',
  'tournaments',
])

export function normalisePublicHandle(value: string) {
  return value.trim().toLocaleLowerCase('en-US')
}

export async function setPublicHandle(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  handle: string | null,
  now = Date.now(),
): Promise<PublicHandleResult> {
  let normalised: string | null = null
  if (handle !== null) {
    normalised = normalisePublicHandle(handle)
    if (!HANDLE.test(normalised)) return { ok: false, reason: 'invalid' }
    if (RESERVED.has(normalised)) return { ok: false, reason: 'reserved' }
    const owner = await database
      .prepare('SELECT id FROM identity_account WHERE public_handle = ?')
      .bind(normalised)
      .first<{ id: string }>()
    if (owner && owner.id !== context.account.id) return { ok: false, reason: 'taken' }
    if (owner) return { ok: true, handle: normalised }
  }

  const writeNonce = createOpaqueToken()
  try {
    await database
      .prepare(
        `UPDATE identity_account
       SET public_handle = ?, updated_at = ?, revision = revision + 1, write_nonce = ?
       WHERE id = ? AND status = 'active'
         AND EXISTS (
           SELECT 1 FROM identity_session AS session
           WHERE session.id = ? AND session.account_id = identity_account.id
             AND session.revoked_at IS NULL AND session.recovery_restricted = 0
             AND session.security_version = identity_account.security_version
             AND session.idle_expires_at > ? AND session.absolute_expires_at > ?
         )`,
      )
      .bind(normalised, now, writeNonce, context.account.id, context.session.id, now, now)
      .run()
  } catch (error) {
    if (normalised && error instanceof Error && /(?:unique|constraint)/i.test(error.message)) {
      return { ok: false, reason: 'taken' }
    }
    throw error
  }

  const stored = await database
    .prepare('SELECT public_handle FROM identity_account WHERE id = ?')
    .bind(context.account.id)
    .first<{ public_handle: string | null }>()
  if ((stored?.public_handle ?? null) !== normalised) {
    return { ok: false, reason: 'session_invalid' }
  }
  return { ok: true, handle: normalised }
}

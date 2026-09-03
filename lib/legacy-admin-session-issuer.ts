import 'server-only'

import { cloudflareBindings } from './cloudflare-bindings'
import { createOpaqueToken, hashOpaqueToken } from './opaque-token.ts'
import type { AdminLoginAdmission } from './queries/admin-login-attempts'

interface AdminAccount {
  id: number
  username: string
  password_salt: string
  password_hash: string
}

export const LEGACY_ADMIN_SESSION_MAX_AGE = 60 * 60 * 8

export class LegacySessionConflictError extends Error {
  constructor() {
    super('An opposing legacy session is active')
    this.name = 'LegacySessionConflictError'
  }
}

function sameValue(left: string, right: string) {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

async function getAdminAccount() {
  return cloudflareBindings()
    .db.prepare('SELECT id, username, password_salt, password_hash FROM admin_account WHERE id = 1')
    .bind()
    .first<AdminAccount>()
}

export async function credentialsAccepted(username: string, password: string) {
  const admin = await getAdminAccount()
  if (!admin) return false
  const [submittedUsername, expectedUsername, submittedPassword] = await Promise.all([
    hashOpaqueToken(username),
    hashOpaqueToken(admin.username),
    hashOpaqueToken(`${admin.password_salt}\0${password}`),
  ])
  return (
    sameValue(submittedUsername, expectedUsername) &&
    sameValue(submittedPassword, admin.password_hash)
  )
}

export async function createAdminSession(
  username: string,
  admission: AdminLoginAdmission,
  opposingParticipantSessionHash: string | null = null,
) {
  const admin = await getAdminAccount()
  if (
    !admin ||
    !sameValue(await hashOpaqueToken(username), await hashOpaqueToken(admin.username))
  ) {
    throw new Error('Admin login is not configured')
  }
  if (
    opposingParticipantSessionHash !== null &&
    !/^[0-9a-f]{64}$/.test(opposingParticipantSessionHash)
  ) {
    throw new Error('Invalid opposing participant session hash')
  }
  const token = createOpaqueToken()
  const tokenHash = await hashOpaqueToken(token)
  const db = cloudflareBindings().db
  const now = Date.now()
  const expiresAt = now + LEGACY_ADMIN_SESSION_MAX_AGE * 1000
  try {
    await db.batch([
      db.prepare('DELETE FROM admin_session WHERE expires_at <= ?').bind(now),
      db
        .prepare(
          'INSERT INTO admin_session (token_hash, admin_id, expires_at) VALUES (?, CASE WHEN ? IS NULL OR NOT EXISTS (SELECT 1 FROM participant_session WHERE token_hash = ? AND expires_at > ?) THEN ? ELSE NULL END, ?)',
        )
        .bind(
          tokenHash,
          opposingParticipantSessionHash,
          opposingParticipantSessionHash,
          now,
          admin.id,
          expiresAt,
        ),
      db
        .prepare('DELETE FROM admin_login_attempt WHERE bucket_start = ? AND fingerprint = ?')
        .bind(admission.bucketStart, admission.fingerprint),
    ])
  } catch (error) {
    if (opposingParticipantSessionHash) {
      const opposingSession = await db
        .prepare(
          'SELECT 1 AS active FROM participant_session WHERE token_hash = ? AND expires_at > ?',
        )
        .bind(opposingParticipantSessionHash, now)
        .first<{ active: number }>()
      if (opposingSession) throw new LegacySessionConflictError()
    }
    throw error
  }
  return token
}

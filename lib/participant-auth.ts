import 'server-only'

import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { NextResponse } from 'next/server'
import { cloudflareBindings } from './cloudflare-bindings'
import { createOpaqueToken, hashOpaqueToken, isOpaqueToken } from './opaque-token.ts'
import { PARTICIPANT_SESSION_COOKIE } from './participant-session-request.ts'

export { participantSessionHashFromRequest } from './participant-session-request.ts'

interface ParticipantSessionRow {
  principal_id: string
  credential_id: string
  expires_at: number
}

interface AdminSessionRow {
  admin_id: number
}

export interface ParticipantIdentity {
  principalId: string
  credentialId: string
  sessionExpiresAt: number
}

const COOKIE_NAME = PARTICIPANT_SESSION_COOKIE
export const LEGACY_ADMIN_SESSION_COOKIE = 'cs2cup_admin'
const SESSION_MAX_AGE = 60 * 60 * 8

export const participantSessionCookie = {
  name: COOKIE_NAME,
  maxAge: SESSION_MAX_AGE,
  options: {
    httpOnly: true,
    path: '/',
    sameSite: 'lax' as const,
    secure: true,
  },
}

export function participantSessionRemainingMs(expiresAt: number) {
  return Number.isSafeInteger(expiresAt) ? expiresAt - Date.now() : 0
}

export async function createParticipantSessionDraft() {
  const token = createOpaqueToken()
  return {
    token,
    tokenHash: await hashOpaqueToken(token),
    expiresAt: Date.now() + SESSION_MAX_AGE * 1000,
  }
}

export function setParticipantSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(COOKIE_NAME, token, {
    ...participantSessionCookie.options,
    maxAge: participantSessionCookie.maxAge,
  })
  return response
}

export function clearParticipantSessionCookie(response: NextResponse) {
  response.cookies.set(COOKIE_NAME, '', {
    ...participantSessionCookie.options,
    maxAge: 0,
  })
  return response
}

// Exported only so the legacy admin guard can compare both server-validated subjects without
// creating an auth-module import cycle. Ordinary callers must use getCurrentParticipant().
export const getCurrentLegacyParticipantSession = cache(
  async (): Promise<ParticipantIdentity | null> => {
    const token = (await cookies()).get(COOKIE_NAME)?.value
    if (!token || !isOpaqueToken(token)) return null
    const session = await cloudflareBindings()
      .db.prepare(
        `SELECT session.principal_id, session.credential_id, session.expires_at
         FROM participant_session AS session
         WHERE session.token_hash = ? AND session.expires_at > ?
           AND NOT EXISTS (
             SELECT 1 FROM identity_legacy_subject_map AS migrated
             WHERE migrated.subject_type = 'participant_principal'
               AND migrated.subject_id = session.principal_id
           )`,
      )
      .bind(await hashOpaqueToken(token), Date.now())
      .first<ParticipantSessionRow>()
    return session
      ? {
          principalId: session.principal_id,
          credentialId: session.credential_id,
          sessionExpiresAt: session.expires_at,
        }
      : null
  },
)

const getCurrentParticipantAccess = cache(async () => {
  const participant = await getCurrentLegacyParticipantSession()
  if (!participant) return { participant: null, conflict: false } as const

  const adminToken = (await cookies()).get(LEGACY_ADMIN_SESSION_COOKIE)?.value
  if (!adminToken) return { participant, conflict: false } as const

  const adminSession = await cloudflareBindings()
    .db.prepare('SELECT admin_id FROM admin_session WHERE token_hash = ? AND expires_at > ?')
    .bind(await hashOpaqueToken(adminToken), Date.now())
    .first<AdminSessionRow>()

  return adminSession
    ? ({ participant: null, conflict: true } as const)
    : ({ participant, conflict: false } as const)
})

export const getCurrentParticipant = cache(async (): Promise<ParticipantIdentity | null> => {
  return (await getCurrentParticipantAccess()).participant
})

export async function hasConflictingLegacyParticipantSession() {
  return (await getCurrentParticipantAccess()).conflict
}

export async function requireParticipant() {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  const hasSessionCookie = Boolean(token)
  if (await hasConflictingLegacyParticipantSession()) {
    redirect('/login?reason=conflict')
  }
  const participant = await getCurrentParticipant()
  if (!participant) redirect(hasSessionCookie ? '/login?reason=expired' : '/login')
  return participant
}

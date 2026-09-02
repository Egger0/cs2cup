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

export interface ParticipantIdentity {
  principalId: string
  credentialId: string
  sessionExpiresAt: number
}

const COOKIE_NAME = PARTICIPANT_SESSION_COOKIE
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

export const getCurrentParticipant = cache(async (): Promise<ParticipantIdentity | null> => {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  if (!token || !isOpaqueToken(token)) return null
  const session = await cloudflareBindings()
    .db.prepare(
      'SELECT principal_id, credential_id, expires_at FROM participant_session WHERE token_hash = ? AND expires_at > ?',
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
})

export async function requireParticipant() {
  const hasSessionCookie = Boolean((await cookies()).get(COOKIE_NAME)?.value)
  const participant = await getCurrentParticipant()
  if (!participant) redirect(hasSessionCookie ? '/login?reason=expired' : '/login')
  return participant
}

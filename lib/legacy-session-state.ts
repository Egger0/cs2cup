import 'server-only'

import type { NextRequest } from 'next/server'
import { cloudflareBindings } from './cloudflare-bindings'
import { hashOpaqueToken, isOpaqueToken } from './opaque-token.ts'
import { LEGACY_ADMIN_SESSION_COOKIE } from './participant-auth'
import { PARTICIPANT_SESSION_COOKIE } from './participant-session-request.ts'

interface ActiveSessionRow {
  active: number
}

export interface LegacySessionState {
  readonly adminActive: boolean
  readonly adminTokenHash: string | null
  readonly participantActive: boolean
  readonly participantTokenHash: string | null
}

/**
 * Reads both legacy cookies from the request that is about to mutate identity state.
 * The hashes are returned even for stale cookies so the final D1 write can defend
 * against the matching opposite session becoming valid after this initial read.
 */
export async function legacySessionStateFromRequest(
  request: Pick<NextRequest, 'cookies'>,
  now = Date.now(),
): Promise<LegacySessionState> {
  const adminToken = request.cookies.get(LEGACY_ADMIN_SESSION_COOKIE)?.value
  const participantToken = request.cookies.get(PARTICIPANT_SESSION_COOKIE)?.value
  const [adminTokenHash, participantTokenHash] = await Promise.all([
    adminToken ? hashOpaqueToken(adminToken) : null,
    participantToken && isOpaqueToken(participantToken) ? hashOpaqueToken(participantToken) : null,
  ])
  const db = cloudflareBindings().db
  const [admin, participant] = await Promise.all([
    adminTokenHash
      ? db
          .prepare('SELECT 1 AS active FROM admin_session WHERE token_hash = ? AND expires_at > ?')
          .bind(adminTokenHash, now)
          .first<ActiveSessionRow>()
      : null,
    participantTokenHash
      ? db
          .prepare(
            'SELECT 1 AS active FROM participant_session WHERE token_hash = ? AND expires_at > ?',
          )
          .bind(participantTokenHash, now)
          .first<ActiveSessionRow>()
      : null,
  ])

  return {
    adminActive: Boolean(admin),
    adminTokenHash,
    participantActive: Boolean(participant),
    participantTokenHash,
  }
}

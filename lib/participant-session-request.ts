import 'server-only'

import type { NextRequest } from 'next/server'
import { hashOpaqueToken, isOpaqueToken } from './opaque-token.ts'

export const PARTICIPANT_SESSION_COOKIE = '__Host-cs2cup_participant'

export async function participantSessionHashFromRequest(request: NextRequest) {
  const token = request.cookies.get(PARTICIPANT_SESSION_COOKIE)?.value
  if (!token || !isOpaqueToken(token)) return null
  return hashOpaqueToken(token)
}

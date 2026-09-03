import 'server-only'

import { hashOpaqueToken, isOpaqueToken } from '../../opaque-token.ts'
import { IDENTITY_SESSION_COOKIE_NAME } from './cookie.ts'

const LEGACY_ADMIN_COOKIE = 'cs2cup_admin'
const LEGACY_PARTICIPANT_COOKIE = '__Host-cs2cup_participant'
const COOKIE_OPTIONS = { httpOnly: true, path: '/', sameSite: 'lax' as const, secure: true }

interface CookieRequest {
  cookies: { get(name: string): { value: string } | undefined }
}

interface CookieResponse {
  cookies: {
    set(name: string, value: string, options: typeof COOKIE_OPTIONS & { maxAge: number }): unknown
  }
}

export async function replacementFromPasskeyRequest(request: CookieRequest) {
  const unified = request.cookies.get(IDENTITY_SESSION_COOKIE_NAME)?.value
  const admin = request.cookies.get(LEGACY_ADMIN_COOKIE)?.value
  const participant = request.cookies.get(LEGACY_PARTICIPANT_COOKIE)?.value
  const [unifiedTokenHash, legacyAdminTokenHash, legacyParticipantTokenHash] = await Promise.all([
    unified && isOpaqueToken(unified) ? hashOpaqueToken(unified) : null,
    admin ? hashOpaqueToken(admin) : null,
    participant && isOpaqueToken(participant) ? hashOpaqueToken(participant) : null,
  ])
  return { unifiedTokenHash, legacyAdminTokenHash, legacyParticipantTokenHash }
}

export function clearLegacyPasskeyCookies<ResponseType extends CookieResponse>(
  response: ResponseType,
) {
  response.cookies.set(LEGACY_ADMIN_COOKIE, '', { ...COOKIE_OPTIONS, maxAge: 0 })
  response.cookies.set(LEGACY_PARTICIPANT_COOKIE, '', { ...COOKIE_OPTIONS, maxAge: 0 })
  return response
}

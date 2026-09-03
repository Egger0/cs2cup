import 'server-only'

import { cookies } from 'next/headers'
import { isOpaqueToken } from '../../opaque-token.ts'
import { SESSION_ABSOLUTE_MS } from './session-draft.ts'

export const IDENTITY_SESSION_COOKIE_NAME = '__Host-cs2cup_session'

export const identitySessionCookie = Object.freeze({
  name: IDENTITY_SESSION_COOKIE_NAME,
  options: Object.freeze({
    httpOnly: true,
    path: '/',
    sameSite: 'lax' as const,
    secure: true,
  }),
})

export interface IdentityCookieResponse {
  cookies: {
    set(
      name: string,
      value: string,
      options: {
        httpOnly: boolean
        path: string
        sameSite: 'lax'
        secure: boolean
        maxAge: number
      },
    ): unknown
  }
}

export async function readIdentitySessionToken() {
  return (await cookies()).get(IDENTITY_SESSION_COOKIE_NAME)?.value ?? null
}

export function setIdentitySessionCookie<ResponseType extends IdentityCookieResponse>(
  response: ResponseType,
  token: string,
  absoluteExpiresAt: number,
  now = Date.now(),
) {
  if (
    !isOpaqueToken(token) ||
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(absoluteExpiresAt)
  ) {
    throw new TypeError('Invalid unified session cookie')
  }
  const remainingMs = Math.min(absoluteExpiresAt - now, SESSION_ABSOLUTE_MS)
  if (remainingMs <= 0) throw new RangeError('Cannot set an expired unified session cookie')
  response.cookies.set(IDENTITY_SESSION_COOKIE_NAME, token, {
    ...identitySessionCookie.options,
    maxAge: Math.max(1, Math.floor(remainingMs / 1000)),
  })
  return response
}

export function clearIdentitySessionCookie<ResponseType extends IdentityCookieResponse>(
  response: ResponseType,
) {
  response.cookies.set(IDENTITY_SESSION_COOKIE_NAME, '', {
    ...identitySessionCookie.options,
    maxAge: 0,
  })
  return response
}

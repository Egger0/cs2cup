import { type NextRequest, NextResponse } from 'next/server'

import { isOpaqueToken } from './opaque-token.ts'

const CEREMONY_COOKIE_NAME = '__Host-cs2cup_passkey_ceremony'
const CEREMONY_MAX_AGE = 5 * 60

const ceremonyCookieOptions = {
  httpOnly: true,
  path: '/',
  sameSite: 'lax' as const,
  secure: true,
}

export function ceremonyTokenFromRequest(request: NextRequest) {
  const value = request.cookies.get(CEREMONY_COOKIE_NAME)?.value
  return value && isOpaqueToken(value) ? value : null
}

export function setCeremonyCookie(response: NextResponse, token: string) {
  response.cookies.set(CEREMONY_COOKIE_NAME, token, {
    ...ceremonyCookieOptions,
    maxAge: CEREMONY_MAX_AGE,
  })
  return response
}

export function clearCeremonyCookie(response: NextResponse) {
  response.cookies.set(CEREMONY_COOKIE_NAME, '', {
    ...ceremonyCookieOptions,
    maxAge: 0,
  })
  return response
}

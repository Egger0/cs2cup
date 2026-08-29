import { resolveSiteOrigin } from './site-config.ts'

export interface AdminSessionCookieEnvironment {
  NEXT_PUBLIC_SITE_URL?: string
  NODE_ENV?: string
}

const ADMIN_COOKIE_NAME = 'cs2cup_admin'
const ADMIN_COOKIE_MAX_AGE_SECONDS = 8 * 60 * 60

export interface ParsedAdminSessionCookie {
  value: string | null
  duplicate: boolean
}

function cookieSecure(environment: AdminSessionCookieEnvironment) {
  const configured = environment.NEXT_PUBLIC_SITE_URL
  if (!configured) throw new Error('NEXT_PUBLIC_SITE_URL is not configured')
  const origin = new URL(resolveSiteOrigin(configured))
  if (origin.protocol === 'https:') return true
  const loopback = origin.hostname === 'localhost' ||
    origin.hostname === '127.0.0.1' ||
    origin.hostname === '[::1]'
  if (environment.NODE_ENV === 'production' && !loopback) {
    throw new Error('Administrator cookies require an HTTPS site origin')
  }
  return false
}

export const adminSessionCookie = {
  name: ADMIN_COOKIE_NAME,
  maxAge: ADMIN_COOKIE_MAX_AGE_SECONDS,
  options(environment: AdminSessionCookieEnvironment = process.env) {
    return {
      httpOnly: true as const,
      secure: cookieSecure(environment),
      sameSite: 'strict' as const,
      path: '/',
      priority: 'high' as const,
    }
  },
}

export function parseAdminSessionCookie(
  headerValue: string | null | undefined,
  cookieName: string,
): ParsedAdminSessionCookie {
  const values: string[] = []
  if (headerValue) {
    for (const segment of headerValue.split(';')) {
      const pair = segment.trim()
      const separator = pair.indexOf('=')
      if (separator < 1 || pair.slice(0, separator) !== cookieName) continue
      values.push(pair.slice(separator + 1))
    }
  }
  return {
    value: values.length === 1 ? values[0] ?? null : null,
    duplicate: values.length > 1,
  }
}

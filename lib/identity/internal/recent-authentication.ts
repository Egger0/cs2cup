import type { AuthenticatedAuthContext } from './contracts.ts'

export const RECENT_AUTHENTICATION_MS = 15 * 60 * 1000

export function hasRecentAuthentication(context: AuthenticatedAuthContext, now: number) {
  return (
    Number.isSafeInteger(now) &&
    now >= 0 &&
    context.session.authenticatedAt >= now - RECENT_AUTHENTICATION_MS &&
    context.session.authenticatedAt <= now
  )
}

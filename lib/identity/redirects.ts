export const IDENTITY_REDIRECT_KEYS = [
  'account',
  'account_security',
  'registration',
  'tournaments',
  'workspaces',
] as const

export type IdentityRedirectKey = (typeof IDENTITY_REDIRECT_KEYS)[number]

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/

function contextRecord(context: unknown) {
  return context && typeof context === 'object' && !Array.isArray(context)
    ? (context as Record<string, unknown>)
    : {}
}

export function isIdentityRedirectKey(value: unknown): value is IdentityRedirectKey {
  return typeof value === 'string' && (IDENTITY_REDIRECT_KEYS as readonly string[]).includes(value)
}

export function resolveIdentityRedirect(key: IdentityRedirectKey, context?: unknown) {
  if (key === 'account') return '/account'
  if (key === 'account_security') return '/account/security'
  if (key === 'tournaments') return '/tournaments'
  if (key === 'workspaces') return '/admin'

  const slug = contextRecord(context).tournamentSlug
  return typeof slug === 'string' && SLUG_PATTERN.test(slug)
    ? `/tournaments/${encodeURIComponent(slug)}/register`
    : '/tournaments'
}

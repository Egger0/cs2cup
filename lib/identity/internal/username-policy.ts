const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9_.-]{1,30}[a-z0-9])?$/
const RESERVED_USERNAMES = new Set([
  'account',
  'admin',
  'administrator',
  'api',
  'auth',
  'cs2cup',
  'help',
  'login',
  'moderator',
  'nbt',
  'nlc',
  'null',
  'owner',
  'root',
  'security',
  'staff',
  'support',
  'system',
  'undefined',
])

export type UsernamePolicyFailure = 'invalid_type' | 'invalid_format' | 'reserved'

export type UsernamePolicyResult =
  | { ok: true; username: string }
  | { ok: false; reason: UsernamePolicyFailure }

export function normalizeUsername(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : null
}

export function evaluateUsernamePolicy(value: unknown): UsernamePolicyResult {
  const username = normalizeUsername(value)
  if (username === null) return { ok: false, reason: 'invalid_type' }
  if (!USERNAME_PATTERN.test(username)) return { ok: false, reason: 'invalid_format' }
  if (RESERVED_USERNAMES.has(username)) return { ok: false, reason: 'reserved' }
  return { ok: true, username }
}

export function isCanonicalStoredUsername(value: unknown): value is string {
  return typeof value === 'string' && USERNAME_PATTERN.test(value)
}

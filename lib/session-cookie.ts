import 'server-only'

export const APPLICATION_SESSION_COOKIE = '__Host-cs2cup-session'
export const LEGACY_SESSION_COOKIE = 'cs2cup_session'

export const SESSION_AUTH_MODES = [
  'legacy',
  'bridge',
  'application',
] as const

export type SessionAuthMode = (typeof SESSION_AUTH_MODES)[number]

export interface SessionCookieEnvironment {
  [name: string]: string | undefined
  SESSION_AUTH_MODE?: string
}

export interface SessionCookieValues {
  application?: string
  legacy?: string
}

export type SelectedSessionCredential =
  | { kind: 'application'; value: string }
  | { kind: 'legacy'; value: string }
  | null

export interface ApplicationSessionCookieOptions {
  readonly httpOnly: true
  readonly secure: true
  readonly sameSite: 'strict'
  readonly path: '/'
  readonly priority: 'high'
  readonly expires: Date
  readonly maxAge: number
}

const COOKIE_BASE = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/',
  priority: 'high',
} as const

export function resolveSessionAuthMode(
  environment: SessionCookieEnvironment = process.env,
): SessionAuthMode {
  const configured = environment.SESSION_AUTH_MODE
  if (configured === undefined) return 'legacy'
  if ((SESSION_AUTH_MODES as readonly string[]).includes(configured)) {
    return configured as SessionAuthMode
  }
  throw new Error('SESSION_AUTH_MODE must be legacy, bridge, or application')
}

export function selectSessionCredential(
  mode: SessionAuthMode,
  values: SessionCookieValues,
): SelectedSessionCredential {
  if (mode === 'legacy') {
    return values.legacy !== undefined
      ? { kind: 'legacy', value: values.legacy }
      : null
  }

  // Presence of the stronger credential is authoritative. Its caller must
  // reject a malformed, expired, revoked, or replayed value without invoking
  // this selector a second time to obtain the legacy credential.
  if (values.application !== undefined) {
    return { kind: 'application', value: values.application }
  }
  if (mode === 'bridge' && values.legacy !== undefined) {
    return { kind: 'legacy', value: values.legacy }
  }
  return null
}

function deadlineMilliseconds(value: string | Date) {
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value)
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError('Invalid application session deadline')
  }
  return milliseconds
}

export function applicationSessionCookieOptions(
  absoluteExpiresAt: string | Date,
  now: Date = new Date(),
): ApplicationSessionCookieOptions {
  const deadline = deadlineMilliseconds(absoluteExpiresAt)
  const current = now.getTime()
  if (!Number.isFinite(current) || deadline <= current) {
    throw new TypeError('Application session deadline has passed')
  }

  // Flooring prevents the browser credential from outliving the database
  // family even when the response crosses a sub-second boundary.
  const maxAge = Math.floor((deadline - current) / 1_000)
  if (maxAge < 1) throw new TypeError('Application session deadline is too near')

  return {
    ...COOKIE_BASE,
    expires: new Date(deadline),
    maxAge,
  }
}

export function deleteApplicationSessionCookieOptions() {
  return {
    ...COOKIE_BASE,
    expires: new Date(0),
    maxAge: 0,
  } as const
}

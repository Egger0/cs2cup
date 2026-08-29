import 'server-only'
import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  ADMIN_PASSWORD_ALGORITHM,
  ADMIN_PASSWORD_HASH_BYTES,
  ADMIN_PASSWORD_ITERATIONS,
  ADMIN_PASSWORD_SALT_BYTES,
  adminAccountFingerprint,
  adminNetworkFingerprint,
  base64UrlToBytes,
  createAdminSessionToken,
  deriveAdminPasswordHash,
  digestAdminSessionToken,
  hexToBytes,
  normalizeAdminPassword,
  normalizeAdminUsername,
  parseAdminAuthPepper,
  sameBytes,
} from './admin-auth-crypto'
import {
  beginLocalAdminLogin,
  createLocalAdminSession,
  endLocalAdminSession,
  useLocalAdminSession,
} from './admin-auth-store'
import {
  adminSessionCookie,
  parseAdminSessionCookie,
} from './admin-session-cookie'
import { DatabaseError } from './database'
import {
  normalizeIpAddress,
  registrationClientIpSource,
} from './ratelimit-fingerprint'

export interface AdminIdentity {
  uid: string
  principalId: string
  sessionId: string
}

export type AdminLoginResult =
  | { kind: 'authenticated'; token: string }
  | { kind: 'invalid' }
  | { kind: 'rate_limited'; retryAfterSeconds: number }

interface PasswordCredential {
  principalId: string
  username: string
  algorithm: typeof ADMIN_PASSWORD_ALGORITHM
  iterations: number
  credentialVersion: number
  saltHex: string
  hashHex: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const INVALID_USERNAME = 'invalid-login-candidate'
const INVALID_PASSWORD = 'invalid-login-candidate-password'

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function parseCredential(value: unknown): PasswordCredential {
  const candidate = record(value)
  if (
    !candidate ||
    typeof candidate.principalId !== 'string' ||
    !UUID.test(candidate.principalId) ||
    typeof candidate.username !== 'string' ||
    normalizeAdminUsername(candidate.username) !== candidate.username ||
    candidate.algorithm !== ADMIN_PASSWORD_ALGORITHM ||
    !Number.isSafeInteger(candidate.iterations) ||
    candidate.iterations !== ADMIN_PASSWORD_ITERATIONS ||
    !Number.isSafeInteger(candidate.credentialVersion) ||
    (candidate.credentialVersion as number) < 1 ||
    typeof candidate.saltHex !== 'string' ||
    typeof candidate.hashHex !== 'string'
  ) {
    throw new Error('Administrator credential response is invalid')
  }
  hexToBytes(candidate.saltHex, ADMIN_PASSWORD_SALT_BYTES)
  hexToBytes(candidate.hashHex, ADMIN_PASSWORD_HASH_BYTES)
  return candidate as unknown as PasswordCredential
}

function parseBeginLogin(value: unknown) {
  const result = record(value)
  if (!result || result.ok !== true || typeof result.allowed !== 'boolean') {
    throw new Error('Administrator login response is invalid')
  }
  if (!result.allowed) {
    if (
      !Number.isSafeInteger(result.retryAfterSeconds) ||
      (result.retryAfterSeconds as number) < 1 ||
      (result.retryAfterSeconds as number) > 900
    ) {
      throw new Error('Administrator login throttle response is invalid')
    }
    return {
      allowed: false as const,
      retryAfterSeconds: result.retryAfterSeconds as number,
    }
  }
  return { allowed: true as const, credential: parseCredential(result.credential) }
}

function parseCreatedSession(value: unknown) {
  const result = record(value)
  if (result?.ok === false) return false
  if (
    !result ||
    result.ok !== true ||
    typeof result.principalId !== 'string' ||
    !UUID.test(result.principalId) ||
    typeof result.sessionId !== 'string' ||
    !UUID.test(result.sessionId)
  ) {
    throw new Error('Administrator session admission response is invalid')
  }
  return true
}

function parseUsedSession(value: unknown): AdminIdentity | null {
  const result = record(value)
  if (result?.ok === false) return null
  if (
    !result ||
    result.ok !== true ||
    typeof result.username !== 'string' ||
    normalizeAdminUsername(result.username) !== result.username ||
    typeof result.principalId !== 'string' ||
    !UUID.test(result.principalId) ||
    typeof result.sessionId !== 'string' ||
    !UUID.test(result.sessionId)
  ) {
    throw new Error('Administrator session response is invalid')
  }
  return {
    uid: result.username,
    principalId: result.principalId.toLowerCase(),
    sessionId: result.sessionId.toLowerCase(),
  }
}

function adminPepper() {
  return parseAdminAuthPepper(process.env.ADMIN_AUTH_PEPPER)
}

function requestNetworkAddress(requestHeaders: Pick<Headers, 'get'>) {
  const source = registrationClientIpSource(
    process.env.REGISTRATION_CLIENT_IP_SOURCE,
    process.env.NODE_ENV !== 'development',
  )
  const value = requestHeaders.get(source) ?? (
    process.env.NODE_ENV === 'development' ? '127.0.0.1' : null
  )
  if (!value) throw new Error(`Trusted client IP header ${source} is missing`)
  return normalizeIpAddress(value)
}

function candidateUsername(value: string) {
  try {
    return { username: normalizeAdminUsername(value), valid: true }
  } catch {
    return { username: INVALID_USERNAME, valid: false }
  }
}

function candidatePassword(value: string) {
  try {
    return { password: normalizeAdminPassword(value), valid: true }
  } catch {
    return { password: INVALID_PASSWORD, valid: false }
  }
}

export async function authenticateAdminCredentials(
  usernameValue: string,
  passwordValue: string,
  requestHeaders: Pick<Headers, 'get'>,
): Promise<AdminLoginResult> {
  const pepper = adminPepper()
  const username = candidateUsername(usernameValue)
  const password = candidatePassword(passwordValue)
  const networkAddress = requestNetworkAddress(requestHeaders)
  const [accountFingerprint, networkFingerprint] = await Promise.all([
    adminAccountFingerprint(username.username, pepper),
    adminNetworkFingerprint(networkAddress, pepper),
  ])

  const beginning = parseBeginLogin(await beginLocalAdminLogin(
    accountFingerprint,
    networkFingerprint,
    username.username,
  ))
  if (!beginning.allowed) {
    return {
      kind: 'rate_limited',
      retryAfterSeconds: beginning.retryAfterSeconds,
    }
  }

  const credential = beginning.credential
  const salt = hexToBytes(credential.saltHex, ADMIN_PASSWORD_SALT_BYTES)
  const expectedHash = hexToBytes(credential.hashHex, ADMIN_PASSWORD_HASH_BYTES)
  const submittedHash = await deriveAdminPasswordHash(
    password.password,
    salt,
    pepper,
    credential.iterations,
  )
  if (
    !username.valid ||
    !password.valid ||
    !sameBytes(submittedHash, expectedHash)
  ) {
    return { kind: 'invalid' }
  }

  const token = createAdminSessionToken()
  const tokenHash = await digestAdminSessionToken(token)
  const admissionRequestId = crypto.randomUUID()
  const admit = async () => parseCreatedSession(await createLocalAdminSession(
    credential.principalId,
    credential.credentialVersion,
    tokenHash,
    accountFingerprint,
    admissionRequestId,
  ))
  const abandonAdmission = async () => {
    try {
      await endLocalAdminSession(tokenHash, crypto.randomUUID())
    } catch (cleanupError) {
      console.error('[admin-auth] ambiguous admission cleanup failed', cleanupError)
    }
  }

  let admitted: boolean
  try {
    admitted = await admit()
  } catch (firstError) {
    if (!(firstError instanceof DatabaseError) || !firstError.retryable) {
      await abandonAdmission()
      throw firstError
    }
    try {
      // Admission is idempotent for this token digest. A retry therefore
      // recovers a response lost after commit without creating another family.
      admitted = await admit()
    } catch {
      await abandonAdmission()
      throw firstError
    }
  }
  return admitted ? { kind: 'authenticated', token } : { kind: 'invalid' }
}

const authenticateAdmin = cache(async (): Promise<AdminIdentity | null> => {
  const parsed = parseAdminSessionCookie(
    (await headers()).get('cookie'),
    adminSessionCookie.name,
  )
  if (parsed.duplicate || !parsed.value) return null
  const token = parsed.value
  try {
    base64UrlToBytes(token, 32)
  } catch {
    return null
  }
  return parseUsedSession(await useLocalAdminSession(
    await digestAdminSessionToken(token),
    crypto.randomUUID(),
  ))
})

export function getCurrentAdmin() {
  return authenticateAdmin()
}

export async function requireAdmin(): Promise<AdminIdentity> {
  const admin = await getCurrentAdmin()
  if (!admin) redirect('/admin/login')
  return admin
}

export async function endAdminSession() {
  const cookieStore = await cookies()
  const parsed = parseAdminSessionCookie(
    (await headers()).get('cookie'),
    adminSessionCookie.name,
  )
  const token = parsed.duplicate ? null : parsed.value
  try {
    if (token) {
      await endLocalAdminSession(
        await digestAdminSessionToken(token),
        crypto.randomUUID(),
      )
    }
  } catch (error) {
    console.error('[admin-auth] server-side logout failed', error)
  } finally {
    cookieStore.set(adminSessionCookie.name, '', {
      ...adminSessionCookie.options(),
      expires: new Date(0),
      maxAge: 0,
    })
  }
}

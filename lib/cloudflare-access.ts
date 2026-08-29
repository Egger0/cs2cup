import 'server-only'

import {
  createRemoteJWKSet,
  jwtVerify,
} from 'jose'

const MAXIMUM_TOKEN_BYTES = 16 * 1_024
const MAXIMUM_IDENTITY_BYTES = 512
const MAXIMUM_AUDIENCE_BYTES = 512
const JWKS_TIMEOUT_MS = 5_000
const JWKS_CACHE_MAX_AGE_MS = 10 * 60 * 1_000
const JWKS_COOLDOWN_MS = 30_000
export const ACCESS_ASSERTION_HEADER = 'cf-access-jwt-assertion'

export interface AccessEnvironment {
  [name: string]: string | undefined
  CF_ACCESS_ISSUER?: string
  CF_ACCESS_AUDIENCE?: string
}

export interface AccessIdentity {
  uid: string
  email?: string
}

export class CloudflareAccessError extends Error {
  readonly code: 'configuration' | 'unavailable'

  constructor(code: 'configuration' | 'unavailable') {
    super(
      code === 'configuration'
        ? 'Cloudflare Access is not configured'
        : 'Cloudflare Access verification is unavailable',
    )
    this.name = 'CloudflareAccessError'
    this.code = code
  }
}

const remoteKeySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function configurationError(): never {
  throw new CloudflareAccessError('configuration')
}

function unavailableError(): never {
  throw new CloudflareAccessError('unavailable')
}

function utf8Length(value: string) {
  return new TextEncoder().encode(value).byteLength
}

function accessConfiguration(environment: AccessEnvironment) {
  const issuerValue = environment.CF_ACCESS_ISSUER
  const audience = environment.CF_ACCESS_AUDIENCE
  if (
    !issuerValue ||
    issuerValue !== issuerValue.trim() ||
    utf8Length(issuerValue) > MAXIMUM_IDENTITY_BYTES ||
    !audience ||
    audience !== audience.trim() ||
    utf8Length(audience) > MAXIMUM_AUDIENCE_BYTES ||
    /[\s\u0000-\u001f\u007f-\u009f]/u.test(audience)
  ) {
    configurationError()
  }

  let issuer: URL
  try {
    issuer = new URL(issuerValue)
  } catch {
    configurationError()
  }
  if (
    issuer.protocol !== 'https:' ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash ||
    issuer.origin !== issuerValue ||
    !issuer.hostname.endsWith('.cloudflareaccess.com') ||
    issuer.hostname === 'cloudflareaccess.com'
  ) {
    configurationError()
  }

  return { issuer: issuerValue, audience }
}

function remoteKeySet(issuer: string) {
  const existing = remoteKeySets.get(issuer)
  if (existing) return existing

  let url: URL
  try {
    url = new URL('/cdn-cgi/access/certs', `${issuer}/`)
  } catch {
    configurationError()
  }
  const created = createRemoteJWKSet(url, {
    timeoutDuration: JWKS_TIMEOUT_MS,
    cooldownDuration: JWKS_COOLDOWN_MS,
    cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
  })
  remoteKeySets.set(issuer, created)
  return created
}

function validIdentityValue(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    utf8Length(value) <= MAXIMUM_IDENTITY_BYTES &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
}

function tokenCandidate(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    utf8Length(value) <= MAXIMUM_TOKEN_BYTES &&
    !/[\s\u0000]/u.test(value) &&
    value.split('.').length === 3
}

const INVALID_TOKEN_CODES = new Set([
  'ERR_JOSE_ALG_NOT_ALLOWED',
  'ERR_JOSE_NOT_SUPPORTED',
  'ERR_JWS_INVALID',
  'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
  'ERR_JWT_CLAIM_VALIDATION_FAILED',
  'ERR_JWT_EXPIRED',
  'ERR_JWT_INVALID',
  'ERR_JWKS_NO_MATCHING_KEY',
  'ERR_JWKS_MULTIPLE_MATCHING_KEYS',
])

export async function verifyAccessJwt(
  token: string,
  environment: AccessEnvironment = process.env,
): Promise<AccessIdentity | null> {
  const { issuer, audience } = accessConfiguration(environment)
  if (!tokenCandidate(token)) return null

  try {
    const verified = await jwtVerify(token, remoteKeySet(issuer), {
      algorithms: ['RS256'],
      issuer,
      audience,
      requiredClaims: ['iss', 'aud', 'exp', 'sub'],
    })
    if (!validIdentityValue(verified.payload.sub) || verified.payload.sub === 'anon') {
      return null
    }
    const email = verified.payload.email
    if (email !== undefined && !validIdentityValue(email)) return null

    return {
      uid: verified.payload.sub,
      ...(typeof email === 'string' ? { email } : {}),
    }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined
    if (typeof code === 'string' && INVALID_TOKEN_CODES.has(code)) return null
    unavailableError()
  }
}

export function accessJwtFromHeaders(requestHeaders: Headers) {
  return requestHeaders.get(ACCESS_ASSERTION_HEADER)
}

export async function verifyAccessRequest(
  requestHeaders: Headers,
  environment: AccessEnvironment = process.env,
) {
  const token = accessJwtFromHeaders(requestHeaders)
  if (!token) return null
  return verifyAccessJwt(token, environment)
}

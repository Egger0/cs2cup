import 'server-only'

import {
  cloudBaseGatewayUrl,
  resolveCloudBaseEnvironmentId,
} from './cloudbase-environment.ts'

const PROVIDER = 'cloudbase'
const REQUEST_TIMEOUT_MS = 5_000
const MAX_RESPONSE_BYTES = 64 * 1_024
const MAX_PROVIDER_TOKEN_BYTES = 16 * 1_024

export interface ProviderProofEnvironment {
  [name: string]: string | undefined
  CLOUDBASE_ENV_ID?: string
  CLOUDBASE_IDENTITY_ISSUER?: string
}

export interface VerifiedProviderProof {
  provider: typeof PROVIDER
  issuer: string
  subject: string
}

export class ProviderProofError extends Error {
  readonly code: 'configuration' | 'verification'

  constructor(code: 'configuration' | 'verification') {
    super(
      code === 'configuration'
        ? 'Identity provider is not configured'
        : 'Identity verification failed',
    )
    this.name = 'ProviderProofError'
    this.code = code
  }
}

function configurationError(): never {
  throw new ProviderProofError('configuration')
}

function verificationError(): never {
  throw new ProviderProofError('verification')
}

function exactIdentityValue(value: unknown) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 512 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    verificationError()
  }
  return value
}

function passwordCandidate(value: unknown, maximumBytes: number) {
  if (typeof value !== 'string') verificationError()
  const bytes = new TextEncoder().encode(value)
  if (bytes.length < 1 || bytes.length > maximumBytes || value.includes('\0')) {
    verificationError()
  }
  return value
}

function pinnedIssuer(
  environment: ProviderProofEnvironment,
  gatewayOrigin: string,
) {
  const configured = environment.CLOUDBASE_IDENTITY_ISSUER
  if (
    !configured ||
    configured.length > 512 ||
    configured !== configured.trim()
  ) {
    configurationError()
  }

  let issuer: URL
  try {
    issuer = new URL(configured)
  } catch {
    configurationError()
  }

  if (
    issuer.protocol !== 'https:' ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash ||
    issuer.origin !== gatewayOrigin ||
    issuer.toString() !== configured
  ) {
    configurationError()
  }
  return configured
}

async function boundedJson(response: Response) {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.includes('application/json') && !contentType.includes('+json')) {
    verificationError()
  }

  const advertisedLength = response.headers.get('content-length')
  if (advertisedLength !== null) {
    const length = Number(advertisedLength)
    if (!Number.isFinite(length) || length < 0 || length > MAX_RESPONSE_BYTES) {
      verificationError()
    }
  }

  const reader = response.body?.getReader()
  if (!reader) verificationError()

  const chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined)
      verificationError()
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      verificationError()
    }
    return value as Record<string, unknown>
  } catch (error) {
    if (error instanceof ProviderProofError) throw error
    verificationError()
  }
}

async function requestJson(
  url: string,
  init: RequestInit,
  gatewayFetch: typeof fetch,
) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await gatewayFetch(url, {
      ...init,
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) verificationError()
    return await boundedJson(response)
  } catch (error) {
    if (error instanceof ProviderProofError) throw error
    verificationError()
  } finally {
    clearTimeout(timeout)
  }
}

function bearerToken(value: unknown) {
  if (typeof value !== 'string') verificationError()
  const length = new TextEncoder().encode(value).length
  if (length < 1 || length > MAX_PROVIDER_TOKEN_BYTES || /[\s\u0000]/u.test(value)) {
    verificationError()
  }
  return value
}

export async function verifyCloudBasePassword(
  usernameValue: unknown,
  passwordValue: unknown,
  environment: ProviderProofEnvironment = process.env,
  gatewayFetch: typeof fetch = fetch,
): Promise<VerifiedProviderProof> {
  let environmentId: string | null
  let signInUrl: string | null
  let introspectUrl: string | null
  let profileUrl: string | null
  try {
    environmentId = resolveCloudBaseEnvironmentId(environment)
    signInUrl = cloudBaseGatewayUrl('/auth/v1/signin', environment)
    introspectUrl = cloudBaseGatewayUrl('/auth/v1/token/introspect', environment)
    profileUrl = cloudBaseGatewayUrl('/auth/v1/user/me', environment)
  } catch {
    configurationError()
  }
  if (!environmentId || !signInUrl || !introspectUrl || !profileUrl) {
    configurationError()
  }

  const issuer = pinnedIssuer(environment, new URL(signInUrl).origin)
  const username = passwordCandidate(usernameValue, 512)
  const password = passwordCandidate(passwordValue, 4_096)

  try {
    const signIn = await requestJson(
      signInUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      },
      gatewayFetch,
    )
    if (signIn.token_type !== 'Bearer') verificationError()
    const token = bearerToken(signIn.access_token)
    const signInSubject = exactIdentityValue(signIn.sub)

    const authorization = { Authorization: `Bearer ${token}` }
    const introspection = await requestJson(
      introspectUrl,
      { method: 'GET', headers: authorization },
      gatewayFetch,
    )
    const introspectionSubject = exactIdentityValue(introspection.sub)
    if (
      introspection.token_type !== 'Bearer' ||
      introspection.client_id !== environmentId ||
      introspectionSubject !== signInSubject
    ) {
      verificationError()
    }

    // Keep the account-status lookup last. A revocation or suspension between
    // the two provider reads therefore tends toward a closed result.
    const profile = await requestJson(
      profileUrl,
      { method: 'GET', headers: authorization },
      gatewayFetch,
    )
    const profileSubject = exactIdentityValue(profile.sub)
    if (profile.status !== 'ACTIVE' || profileSubject !== signInSubject) {
      verificationError()
    }

    return { provider: PROVIDER, issuer, subject: profileSubject }
  } catch (error) {
    if (error instanceof ProviderProofError) throw error
    verificationError()
  }
}

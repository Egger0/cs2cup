import 'server-only'

import { callPrivateFunction } from './rdb.ts'
import {
  assertCanonicalSessionToken,
  digestSessionToken,
  generateSessionToken,
} from './session-token.ts'
import type { VerifiedProviderProof } from './provider-proof.ts'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const BYTEA_SHA256_PATTERN = /^\\x[0-9a-f]{64}$/
const TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|([+-])(\d{2}):(\d{2}))$/
const DEFAULT_RPC_TIMEOUT_MS = 5_000
const MAXIMUM_RPC_TIMEOUT_MS = 30_000
const MAXIMUM_LOGIN_RETRY_SECONDS = 900

export type SessionRpc = (
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<unknown>

export interface SessionStoreOptions {
  rpc?: SessionRpc
  requestId?: string
  rpcTimeoutMs?: number
}

export interface SessionEnvelope {
  sessionId: string
  principalId: string
  idleExpiresAt: string
  absoluteExpiresAt: string
  rotateAfter: string
}

export class SessionStoreError extends Error {
  readonly code: 'invalid_input' | 'invalid_response' | 'unavailable'

  constructor(code: 'invalid_input' | 'invalid_response' | 'unavailable') {
    const messages = {
      invalid_input: 'Invalid session service input',
      invalid_response: 'Session service returned an invalid response',
      unavailable: 'Session service is unavailable',
    } as const
    super(messages[code])
    this.name = 'SessionStoreError'
    this.code = code
  }
}

function invalidInput(): never {
  throw new SessionStoreError('invalid_input')
}

function invalidResponse(): never {
  throw new SessionStoreError('invalid_response')
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidResponse()
  return value as Record<string, unknown>
}

function uuid(value: unknown) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) invalidResponse()
  return value.toLowerCase()
}

function requestUuid(value: unknown) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) invalidInput()
  return value.toLowerCase()
}

function timestamp(value: unknown) {
  if (typeof value !== 'string') invalidResponse()
  const match = TIMESTAMP_PATTERN.exec(value)
  if (!match) invalidResponse()
  const [, yearText, monthText, dayText, hourText, minuteText, secondText,
    fractionText, offsetSign, offsetHourText, offsetMinuteText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText)
  const offsetMinute = offsetMinuteText === undefined
    ? 0
    : Number(offsetMinuteText)
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1]
  if (
    year < 1 ||
    month < 1 || month > 12 ||
    day < 1 || day > (daysInMonth ?? 0) ||
    hour > 23 || minute > 59 || second > 59 ||
    offsetHour > 23 || offsetMinute > 59
  ) {
    invalidResponse()
  }

  const utc = new Date(0)
  utc.setUTCFullYear(year, month - 1, day)
  utc.setUTCHours(hour, minute, second, 0)
  const epochMilliseconds = utc.getTime()
  if (!Number.isFinite(epochMilliseconds)) invalidResponse()
  const fractionMicroseconds = BigInt((fractionText ?? '').padEnd(6, '0') || '0')
  const offsetDirection = offsetSign === '-' ? -1n : 1n
  const offsetMicroseconds = offsetDirection *
    BigInt(offsetHour * 60 + offsetMinute) * 60_000_000n
  return {
    value,
    microseconds: BigInt(epochMilliseconds) * 1_000n +
      fractionMicroseconds - offsetMicroseconds,
  }
}

function parseSessionEnvelope(value: Record<string, unknown>): SessionEnvelope {
  const idle = timestamp(value.idleExpiresAt)
  const absolute = timestamp(value.absoluteExpiresAt)
  const rotate = timestamp(value.rotateAfter)
  const envelope = {
    sessionId: uuid(value.sessionId),
    principalId: uuid(value.principalId),
    idleExpiresAt: idle.value,
    absoluteExpiresAt: absolute.value,
    rotateAfter: rotate.value,
  }
  if (
    idle.microseconds > absolute.microseconds ||
    rotate.microseconds > absolute.microseconds
  ) {
    invalidResponse()
  }
  return envelope
}

function serviceRpc(rpc: SessionRpc | undefined): SessionRpc {
  if (rpc) return rpc
  return (name, args, signal) =>
    callPrivateFunction<unknown>(name, args, { signal })
}

function rpcTimeout(value: number | undefined) {
  if (value === undefined) return DEFAULT_RPC_TIMEOUT_MS
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAXIMUM_RPC_TIMEOUT_MS
  ) {
    invalidInput()
  }
  return value
}

async function invoke(
  name: string,
  args: Record<string, unknown>,
  rpc?: SessionRpc,
  timeoutValue?: number,
) {
  const timeoutMs = rpcTimeout(timeoutValue)
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort()
      reject(new SessionStoreError('unavailable'))
    }, timeoutMs)
  })
  try {
    const request = Promise.resolve().then(() =>
      serviceRpc(rpc)(name, args, controller.signal),
    )
    return await Promise.race([request, deadline])
  } catch {
    // Never retain the transport error as `cause`: PostgREST error bodies can
    // contain database diagnostics. Even a forged/mutated SessionStoreError
    // must not survive this adapter boundary.
    throw new SessionStoreError('unavailable')
  } finally {
    clearTimeout(timeout)
  }
}

export function createSessionRequestId(implementation: Crypto = globalThis.crypto) {
  if (!implementation?.randomUUID) invalidInput()
  return requestUuid(implementation.randomUUID())
}

function resolvedRequestId(options: SessionStoreOptions) {
  return options.requestId === undefined
    ? createSessionRequestId()
    : requestUuid(options.requestId)
}

async function tokenDigest(token: string) {
  try {
    assertCanonicalSessionToken(token)
    return await digestSessionToken(token)
  } catch {
    invalidInput()
  }
}

function digestFingerprint(value: string) {
  if (!BYTEA_SHA256_PATTERN.test(value)) invalidInput()
  return value
}

function verifiedProof(value: unknown): VerifiedProviderProof {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidInput()
  }
  const candidate = value as Record<string, unknown>
  if (
    candidate.provider !== 'cloudbase' ||
    typeof candidate.issuer !== 'string' ||
    typeof candidate.subject !== 'string' ||
    candidate.issuer.length < 1 || candidate.issuer.length > 512 ||
    candidate.subject.length < 1 || candidate.subject.length > 512 ||
    candidate.issuer !== candidate.issuer.trim() ||
    candidate.subject !== candidate.subject.trim() ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(candidate.issuer) ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(candidate.subject)
  ) {
    invalidInput()
  }
  return {
    provider: candidate.provider,
    issuer: candidate.issuer,
    subject: candidate.subject,
  }
}

export async function admitAdminApplicationSession(
  proof: VerifiedProviderProof,
  options: SessionStoreOptions & { candidateToken?: string } = {},
) {
  const identity = verifiedProof(proof)
  const requestId = resolvedRequestId(options)
  const candidateToken = options.candidateToken ?? generateSessionToken()
  const tokenHash = await tokenDigest(candidateToken)
  const response = record(await invoke(
    'admit_admin_app_session',
    {
      p_provider: identity.provider,
      p_issuer: identity.issuer,
      p_subject: identity.subject,
      p_token_hash: tokenHash,
      p_request_id: requestId,
    },
    options.rpc,
    options.rpcTimeoutMs,
  ))
  if (response.ok === false) return { ok: false as const }
  if (response.ok !== true) invalidResponse()
  return {
    ok: true as const,
    ...parseSessionEnvelope(response),
    token: candidateToken,
  }
}

export async function validateApplicationSession(
  presentedToken: string,
  options: SessionStoreOptions & { replacementToken?: string } = {},
) {
  const requestId = resolvedRequestId(options)
  const replacementToken = options.replacementToken ?? generateSessionToken()
  if (presentedToken === replacementToken) invalidInput()

  const [tokenHash, replacementHash] = await Promise.all([
    tokenDigest(presentedToken),
    tokenDigest(replacementToken),
  ])
  const response = record(await invoke(
    'use_app_session',
    {
      p_token_hash: tokenHash,
      p_replacement_hash: replacementHash,
      p_request_id: requestId,
    },
    options.rpc,
    options.rpcTimeoutMs,
  ))
  if (response.ok === false) return { ok: false as const }
  if (response.ok !== true) invalidResponse()
  if (
    response.status !== 'active' &&
    response.status !== 'grace' &&
    response.status !== 'rotated'
  ) {
    invalidResponse()
  }

  return {
    ok: true as const,
    status: response.status,
    ...parseSessionEnvelope(response),
    ...(response.status === 'rotated' ? { replacementToken } : {}),
  }
}

export async function logoutApplicationSession(
  presentedToken: string,
  options: SessionStoreOptions = {},
) {
  const response = record(await invoke(
    'logout_app_session',
    {
      p_token_hash: await tokenDigest(presentedToken),
      p_request_id: resolvedRequestId(options),
    },
    options.rpc,
    options.rpcTimeoutMs,
  ))
  if (response.ok !== true || typeof response.revoked !== 'boolean') {
    invalidResponse()
  }
  return { ok: true as const, revoked: response.revoked }
}

export async function authorizeAdminPrincipal(
  principalId: string,
  options: Pick<SessionStoreOptions, 'rpc' | 'rpcTimeoutMs'> = {},
) {
  const response = record(await invoke(
    'authorize_admin_principal',
    { p_principal_id: requestUuid(principalId) },
    options.rpc,
    options.rpcTimeoutMs,
  ))
  if (response.ok !== true || typeof response.authorized !== 'boolean') {
    invalidResponse()
  }
  return response.authorized
}

export async function consumeLoginAttempt(
  accountFingerprint: string,
  networkFingerprint: string,
  options: Pick<SessionStoreOptions, 'rpc' | 'rpcTimeoutMs'> = {},
) {
  const response = record(await invoke(
    'consume_login_attempt',
    {
      p_account_fingerprint: digestFingerprint(accountFingerprint),
      p_network_fingerprint: digestFingerprint(networkFingerprint),
    },
    options.rpc,
    options.rpcTimeoutMs,
  ))
  if (
    response.ok !== true ||
    typeof response.allowed !== 'boolean' ||
    !Number.isSafeInteger(response.retryAfterSeconds) ||
    (response.retryAfterSeconds as number) < 0 ||
    (response.retryAfterSeconds as number) > MAXIMUM_LOGIN_RETRY_SECONDS ||
    (response.allowed && response.retryAfterSeconds !== 0) ||
    (!response.allowed && response.retryAfterSeconds === 0)
  ) {
    invalidResponse()
  }
  return {
    allowed: response.allowed,
    retryAfterSeconds: response.retryAfterSeconds as number,
  }
}

export async function clearLoginAccountThrottle(
  accountFingerprint: string,
  options: Pick<SessionStoreOptions, 'rpc' | 'rpcTimeoutMs'> = {},
) {
  const response = record(await invoke(
    'clear_login_account_throttle',
    { p_account_fingerprint: digestFingerprint(accountFingerprint) },
    options.rpc,
    options.rpcTimeoutMs,
  ))
  if (response.ok !== true || typeof response.cleared !== 'boolean') {
    invalidResponse()
  }
  return response.cleared
}

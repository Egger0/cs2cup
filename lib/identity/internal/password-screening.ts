import 'server-only'

import { getCloudflareContext } from '@opennextjs/cloudflare'

const RANGE_ENDPOINT = 'https://api.pwnedpasswords.com/range/'
const RANGE_PREFIX = /^[0-9A-F]{5}$/
const RANGE_LINE = /^([0-9A-F]{35}):([0-9]+)$/
const MAX_RESPONSE_BYTES = 128 * 1024
const MAX_RESPONSE_LINES = Math.ceil(MAX_RESPONSE_BYTES / 37)
const DEFAULT_TIMEOUT_MS = 4_000

declare global {
  interface CloudflareEnv {
    IDENTITY_PASSWORD_RANGE?: PasswordRangeService
    IDENTITY_PASSWORD_SCREENING_LOCAL_SERVICE?: string
    NEXT_PUBLIC_SITE_URL?: string
  }
}

interface PasswordRangeService {
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>
}

export class PasswordScreeningUnavailableError extends Error {
  constructor(message = 'Password screening service is unavailable') {
    super(message)
    this.name = 'PasswordScreeningUnavailableError'
  }
}

export interface PwnedPasswordResult {
  readonly compromised: boolean
  readonly occurrenceCount: number
}

export interface PwnedPasswordOptions {
  fetcher?: typeof fetch
  timeoutMs?: number
}

function configurationUnavailable(): never {
  throw new PasswordScreeningUnavailableError('Local password range configuration is invalid')
}

export function resolveLocalPasswordRangeService(
  siteOrigin: unknown,
  configured: unknown,
  service: unknown,
): PasswordRangeService | null {
  if (configured === undefined) return null
  if (
    typeof siteOrigin !== 'string' ||
    !siteOrigin ||
    siteOrigin !== siteOrigin.trim() ||
    configured !== 'browser-check' ||
    !service ||
    typeof service !== 'object' ||
    !('fetch' in service) ||
    typeof service.fetch !== 'function'
  ) {
    configurationUnavailable()
  }

  let site: URL
  try {
    site = new URL(siteOrigin)
  } catch {
    configurationUnavailable()
  }
  if (
    site.origin !== siteOrigin ||
    site.protocol !== 'http:' ||
    site.hostname !== 'localhost' ||
    site.username ||
    site.password ||
    site.pathname !== '/' ||
    site.search ||
    site.hash
  ) {
    configurationUnavailable()
  }
  return service as PasswordRangeService
}

async function runtimeRangeFetch(input: string | URL | Request, init?: RequestInit) {
  const env = getCloudflareContext().env
  const localService = resolveLocalPasswordRangeService(
    env.NEXT_PUBLIC_SITE_URL,
    env.IDENTITY_PASSWORD_SCREENING_LOCAL_SERVICE,
    env.IDENTITY_PASSWORD_RANGE,
  )
  if (!localService) return fetch(input, init)

  const requested = String(input)
  const prefix = requested.startsWith(RANGE_ENDPOINT) ? requested.slice(RANGE_ENDPOINT.length) : ''
  if (!RANGE_PREFIX.test(prefix)) configurationUnavailable()
  return localService.fetch(`https://password-range.browser.invalid/range/${prefix}`, init)
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

async function sha1ForRangeLookup(value: string) {
  // SHA-1 is required by the HIBP range protocol only; it is never used as a password verifier.
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(value))
  return bytesToHex(new Uint8Array(digest))
}

async function boundedText(response: Response) {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    const parsed = Number(contentLength)
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_RESPONSE_BYTES) {
      throw new PasswordScreeningUnavailableError('Password range response is oversized')
    }
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new PasswordScreeningUnavailableError('Password range response is oversized')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(joined)
  } catch {
    throw new PasswordScreeningUnavailableError('Password range response is not UTF-8')
  }
}

function occurrenceForSuffix(payload: string, expectedSuffix: string) {
  const lines = payload.split(/\r?\n/).filter(Boolean)
  if (lines.length > MAX_RESPONSE_LINES) {
    throw new PasswordScreeningUnavailableError('Password range response has too many rows')
  }
  let match = 0
  for (const line of lines) {
    const parsed = RANGE_LINE.exec(line)
    if (!parsed) throw new PasswordScreeningUnavailableError('Password range response is invalid')
    const count = Number(parsed[2])
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new PasswordScreeningUnavailableError('Password range count is invalid')
    }
    if (parsed[1] === expectedSuffix) match = count
  }
  return match
}

export async function checkPwnedPassword(
  normalizedPassword: string,
  options: PwnedPasswordOptions = {},
): Promise<PwnedPasswordResult> {
  if (typeof normalizedPassword !== 'string') throw new TypeError('Password must be normalized')
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 10_000) {
    throw new TypeError('Invalid password screening timeout')
  }
  const passwordHash = await sha1ForRangeLookup(normalizedPassword)
  const prefix = passwordHash.slice(0, 5)
  const suffix = passwordHash.slice(5)
  if (!RANGE_PREFIX.test(prefix)) throw new Error('Unexpected password hash encoding')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await (options.fetcher ?? runtimeRangeFetch)(`${RANGE_ENDPOINT}${prefix}`, {
      method: 'GET',
      headers: {
        Accept: 'text/plain',
        'Add-Padding': 'true',
        'User-Agent': 'cs2cup-password-screening/1',
      },
      redirect: 'manual',
      signal: controller.signal,
    })
    if (!response.ok || response.status !== 200) {
      throw new PasswordScreeningUnavailableError('Password range request failed')
    }
    const occurrenceCount = occurrenceForSuffix(await boundedText(response), suffix)
    return { compromised: occurrenceCount > 0, occurrenceCount }
  } catch (error) {
    if (error instanceof PasswordScreeningUnavailableError) throw error
    throw new PasswordScreeningUnavailableError()
  } finally {
    clearTimeout(timeout)
  }
}

function comparable(value: string) {
  return value
    .normalize('NFC')
    .toLocaleLowerCase('en-US')
    .replaceAll(/[^\p{L}\p{N}]+/gu, '')
}

/** Rejects account/site terms before the remote compromised-password check. */
export function containsPasswordContext(normalizedPassword: string, terms: readonly string[]) {
  const password = comparable(normalizedPassword)
  return terms.some(term => {
    const candidate = comparable(term)
    return candidate.length >= 4 && password.includes(candidate)
  })
}

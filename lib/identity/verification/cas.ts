import 'server-only'

import { isOpaqueToken } from '../../opaque-token.ts'
import { VerificationAdapterError, type VerifiedExternalIdentity } from './types.ts'

const PROVIDER_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/
const SERVICE_TICKET_PATTERN = /^ST-[A-Za-z0-9._~-]{1,508}$/
const MAX_RESPONSE_BYTES = 64 * 1024
const DEFAULT_TIMEOUT_MS = 8_000

export interface CasVerificationConfig {
  issuer: string
  provider: string
  callbackUrl: string
  validationPath: '/serviceValidate' | '/p3/serviceValidate'
  timeoutMs: number
}

interface CasConfigurationInput {
  issuer: string
  callbackUrl: string
  provider?: string
  validationPath?: '/serviceValidate' | '/p3/serviceValidate'
  timeoutMs?: number
  allowHttpLocalhost?: boolean
}

function exactUrl(value: string, kind: 'issuer' | 'callback', allowHttpLocalhost: boolean) {
  let url: URL
  try {
    url = new URL(value)
  } catch (error) {
    throw new VerificationAdapterError('invalid_configuration', error)
  }
  const local = allowHttpLocalhost && url.hostname === 'localhost'
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
  ) {
    throw new VerificationAdapterError('invalid_configuration')
  }
  if (kind === 'issuer') {
    if (url.search || url.pathname.endsWith('/')) {
      throw new VerificationAdapterError('invalid_configuration')
    }
  } else if (url.search || !url.pathname.endsWith('/auth/callback/cas')) {
    throw new VerificationAdapterError('invalid_configuration')
  }
  return url
}

export function resolveCasVerificationConfig(input: CasConfigurationInput): CasVerificationConfig {
  const allowLocal = input.allowHttpLocalhost === true
  const issuer = exactUrl(input.issuer, 'issuer', allowLocal)
  const callback = exactUrl(input.callbackUrl, 'callback', allowLocal)
  const provider = input.provider ?? 'campus-cas'
  const validationPath = input.validationPath ?? '/serviceValidate'
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (
    !PROVIDER_PATTERN.test(provider) ||
    !['/serviceValidate', '/p3/serviceValidate'].includes(validationPath) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > 15_000
  ) {
    throw new VerificationAdapterError('invalid_configuration')
  }
  return {
    issuer: issuer.toString().replace(/\/$/, ''),
    callbackUrl: callback.toString(),
    provider,
    validationPath,
    timeoutMs,
  }
}

export function casServiceUrl(config: CasVerificationConfig, state: string) {
  if (!isOpaqueToken(state)) throw new VerificationAdapterError('invalid_request')
  const service = new URL(config.callbackUrl)
  service.searchParams.set('state', state)
  return service.toString()
}

export function casLoginUrl(
  config: CasVerificationConfig,
  input: { state: string; requirePrimaryCredentials?: boolean },
) {
  const login = new URL(`${config.issuer}/login`)
  login.searchParams.set('service', casServiceUrl(config, input.state))
  if (input.requirePrimaryCredentials) login.searchParams.set('renew', 'true')
  return login.toString()
}

function validationUrl(config: CasVerificationConfig, ticket: string, state: string) {
  if (!SERVICE_TICKET_PATTERN.test(ticket)) {
    throw new VerificationAdapterError('invalid_request')
  }
  const validation = new URL(`${config.issuer}${config.validationPath}`)
  validation.searchParams.set('service', casServiceUrl(config, state))
  validation.searchParams.set('ticket', ticket)
  return validation
}

async function boundedResponseText(response: Response) {
  const declaredLength = response.headers.get('content-length')
  if (
    declaredLength &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES)
  ) {
    throw new VerificationAdapterError('invalid_provider_response')
  }
  const reader = response.body?.getReader()
  if (!reader) throw new VerificationAdapterError('invalid_provider_response')
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new VerificationAdapterError('invalid_provider_response')
    }
    chunks.push(value)
  }
  const body = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch (error) {
    throw new VerificationAdapterError('invalid_provider_response', error)
  }
}

function decodeXmlText(value: string) {
  if (/&(?!(?:#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);)/i.test(value)) {
    throw new VerificationAdapterError('invalid_provider_response')
  }
  const decoded = value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, entity => {
    const key = entity.slice(1, -1).toLowerCase()
    if (key === 'amp') return '&'
    if (key === 'lt') return '<'
    if (key === 'gt') return '>'
    if (key === 'quot') return '"'
    if (key === 'apos') return "'"
    const radix = key.startsWith('#x') ? 16 : 10
    const source = key.slice(radix === 16 ? 2 : 1)
    const point = Number.parseInt(source, radix)
    if (!Number.isSafeInteger(point) || point <= 0 || point > 0x10ffff) {
      throw new VerificationAdapterError('invalid_provider_response')
    }
    return String.fromCodePoint(point)
  })
  return decoded.trim()
}

function casSubject(xml: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || /<(?:[\w.-]+:)?(?:proxies|proxy)\b/i.test(xml)) {
    throw new VerificationAdapterError('invalid_provider_response')
  }
  if (/<(?:[\w.-]+:)?authenticationFailure\b/i.test(xml)) {
    throw new VerificationAdapterError('provider_rejected')
  }
  const success = [
    ...xml.matchAll(
      /<(?:[\w.-]+:)?authenticationSuccess\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?authenticationSuccess\s*>/gi,
    ),
  ]
  if (success.length !== 1) throw new VerificationAdapterError('invalid_provider_response')
  const users = [
    ...(success[0]?.[1] ?? '').matchAll(
      /<(?:[\w.-]+:)?user\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?user\s*>/gi,
    ),
  ]
  if (users.length !== 1 || /<[^>]+>/.test(users[0]?.[1] ?? '')) {
    throw new VerificationAdapterError('invalid_provider_response')
  }
  const subject = decodeXmlText(users[0]?.[1] ?? '')
  if (!subject || subject.length > 500 || /[\u0000-\u001f\u007f]/.test(subject)) {
    throw new VerificationAdapterError('invalid_provider_response')
  }
  return subject
}

function displayHint(subject: string) {
  if (subject.length <= 2) return `${subject.slice(0, 1)}*`
  return `${subject.slice(0, 1)}***${subject.slice(-2)}`
}

export async function completeCasVerification(
  config: CasVerificationConfig,
  input: { ticket: string; state: string; fetch?: typeof fetch },
): Promise<VerifiedExternalIdentity> {
  const request = validationUrl(config, input.ticket, input.state)
  let response: Response
  try {
    response = await (input.fetch ?? fetch)(request, {
      method: 'GET',
      headers: { accept: 'application/xml, text/xml' },
      redirect: 'manual',
      signal: AbortSignal.timeout(config.timeoutMs),
    })
  } catch (error) {
    throw new VerificationAdapterError('provider_unavailable', error)
  }
  if (response.status !== 200) throw new VerificationAdapterError('provider_unavailable')
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/xml' && contentType !== 'text/xml') {
    throw new VerificationAdapterError('invalid_provider_response')
  }
  const subject = casSubject(await boundedResponseText(response))
  return {
    adapterKind: 'cas',
    provider: config.provider,
    issuer: config.issuer,
    subject,
    displayHint: displayHint(subject),
    recoveryCapable: true,
  }
}

import 'server-only'

const ACCOUNT_DOMAIN = 'cs2cup:login-account-fingerprint:v1\0'
const NETWORK_DOMAIN = 'cs2cup:login-network-fingerprint:v1\0'
const MINIMUM_SECRET_BYTES = 32
const MAXIMUM_SECRET_BYTES = 1_024
const MAXIMUM_ACCOUNT_BYTES = 512

export type LoginClientIpSource = 'x-real-ip' | 'cf-connecting-ip'

export interface LoginFingerprintEnvironment {
  [name: string]: string | undefined
  LOGIN_FINGERPRINT_SECRET?: string
  LOGIN_CLIENT_IP_SOURCE?: string
}

export class LoginFingerprintError extends Error {
  constructor(
    message:
      | 'Login fingerprint is not configured'
      | 'Invalid login account candidate'
      | 'Trusted login network is unavailable',
  ) {
    super(message)
    this.name = 'LoginFingerprintError'
  }
}

function webCrypto(implementation: Crypto = globalThis.crypto) {
  if (!implementation?.subtle) {
    throw new LoginFingerprintError('Login fingerprint is not configured')
  }
  return implementation
}

function secretBytes(environment: LoginFingerprintEnvironment) {
  const value = environment.LOGIN_FINGERPRINT_SECRET
  if (!value || value !== value.trim()) {
    throw new LoginFingerprintError('Login fingerprint is not configured')
  }
  const bytes = new TextEncoder().encode(value)
  if (bytes.length < MINIMUM_SECRET_BYTES || bytes.length > MAXIMUM_SECRET_BYTES) {
    throw new LoginFingerprintError('Login fingerprint is not configured')
  }
  return bytes
}

function hex(bytes: Uint8Array) {
  let output = ''
  for (const byte of bytes) output += byte.toString(16).padStart(2, '0')
  return output
}

async function fingerprint(
  domain: string,
  value: string,
  environment: LoginFingerprintEnvironment,
  implementation?: Crypto,
) {
  const crypto = webCrypto(implementation)
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes(environment),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${domain}${value}`),
  )
  return `\\x${hex(new Uint8Array(signature))}`
}

export function isValidLoginAccountCandidate(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  const bytes = new TextEncoder().encode(value)
  return bytes.length <= MAXIMUM_ACCOUNT_BYTES &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
}

export async function fingerprintLoginAccount(
  candidate: unknown,
  environment: LoginFingerprintEnvironment = process.env,
  implementation?: Crypto,
) {
  // The exact case-sensitive candidate is intentional. CloudBase usernames
  // are case-sensitive; trimming or case folding would merge distinct account
  // throttle buckets. Invalid or oversized values still consume a shared
  // account bucket before the provider is called; the validity predicate is
  // returned separately to the login orchestrator and no raw value escapes.
  const material = isValidLoginAccountCandidate(candidate)
    ? `valid\0${candidate}`
    : 'invalid'
  return fingerprint(ACCOUNT_DOMAIN, material, environment, implementation)
}

export function resolveLoginClientIpSource(
  environment: LoginFingerprintEnvironment = process.env,
): LoginClientIpSource {
  const value = environment.LOGIN_CLIENT_IP_SOURCE
  if (value === 'x-real-ip' || value === 'cf-connecting-ip') return value
  throw new LoginFingerprintError('Login fingerprint is not configured')
}

function parseIpv4(value: string) {
  const parts = value.split('.')
  if (parts.length !== 4) return null
  const bytes: number[] = []
  for (const part of parts) {
    if (!/^(?:0|[1-9][0-9]{0,2})$/.test(part)) return null
    const byte = Number(part)
    if (byte > 255) return null
    bytes.push(byte)
  }
  return Uint8Array.from(bytes)
}

function parseIpv6(value: string) {
  if (!value || value.includes('%') || value.includes(':::')) return null
  let address = value

  if (address.includes('.')) {
    const finalColon = address.lastIndexOf(':')
    if (finalColon < 0) return null
    const ipv4 = parseIpv4(address.slice(finalColon + 1))
    if (!ipv4) return null
    const [first, second, third, fourth] = ipv4
    if (
      first === undefined || second === undefined ||
      third === undefined || fourth === undefined
    ) return null
    address = `${address.slice(0, finalColon)}:${
      ((first << 8) | second).toString(16)
    }:${((third << 8) | fourth).toString(16)}`
  }

  const compression = address.indexOf('::')
  if (compression !== -1 && compression !== address.lastIndexOf('::')) return null

  const parseSide = (side: string) => {
    if (!side) return []
    const parts = side.split(':')
    if (parts.some(part => !/^[0-9a-f]{1,4}$/i.test(part))) return null
    return parts.map(part => Number.parseInt(part, 16))
  }

  let groups: number[]
  if (compression === -1) {
    const complete = parseSide(address)
    if (!complete || complete.length !== 8) return null
    groups = complete
  } else {
    const left = parseSide(address.slice(0, compression))
    const right = parseSide(address.slice(compression + 2))
    if (!left || !right || left.length + right.length >= 8) return null
    groups = [
      ...left,
      ...Array.from({ length: 8 - left.length - right.length }, () => 0),
      ...right,
    ]
  }

  const bytes = new Uint8Array(16)
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index]
    if (group === undefined) return null
    bytes[index * 2] = group >>> 8
    bytes[index * 2 + 1] = group & 0xff
  }
  return bytes
}

export function canonicalLoginNetwork(value: string) {
  const address = value.trim()
  if (!address || address.includes(',') || address.includes(' ')) {
    throw new LoginFingerprintError('Trusted login network is unavailable')
  }

  const ipv4 = parseIpv4(address)
  if (ipv4) return `ipv4:${Array.from(ipv4).join('.')}`

  const ipv6 = parseIpv6(address)
  if (!ipv6) {
    throw new LoginFingerprintError('Trusted login network is unavailable')
  }

  const mapped = ipv6.slice(0, 10).every(byte => byte === 0) &&
    ipv6[10] === 0xff && ipv6[11] === 0xff
  if (mapped) return `ipv4:${Array.from(ipv6.slice(12)).join('.')}`

  // One throttle bucket per IPv6 /64 avoids an attacker bypassing the network
  // dimension by cycling privacy-interface identifiers.
  return `ipv6-64:${hex(ipv6.slice(0, 8))}`
}

export async function fingerprintLoginNetwork(
  headers: Headers,
  environment: LoginFingerprintEnvironment = process.env,
  options: { fallbackAddress?: string; crypto?: Crypto } = {},
) {
  const source = resolveLoginClientIpSource(environment)
  const header = headers.get(source)
  const address = header ?? options.fallbackAddress
  if (!address) {
    throw new LoginFingerprintError('Trusted login network is unavailable')
  }
  const network = canonicalLoginNetwork(address)
  return fingerprint(NETWORK_DOMAIN, network, environment, options.crypto)
}

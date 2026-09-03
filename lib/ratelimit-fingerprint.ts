import { createHmac } from 'node:crypto'
import { isIP } from 'node:net'

const REGISTRATION_FINGERPRINT_VERSION = 'v1'
export const MIN_FINGERPRINT_SECRET_BYTES = 32

type RegistrationClientIpSource = 'x-real-ip' | 'cf-connecting-ip'
export type RateLimitFingerprintScope = 'registration' | 'admin-login'

const FINGERPRINT_CONTEXT: Record<RateLimitFingerprintScope, string> = {
  registration: 'cs2cup:registration-rate-limit',
  'admin-login': 'cs2cup:admin-login-rate-limit',
}

function normalizeIpAddress(value: string) {
  let address = value.trim()

  if (address.startsWith('[') && address.endsWith(']')) {
    address = address.slice(1, -1)
  }

  const version = isIP(address)
  if (version === 0) {
    throw new Error('The trusted client IP header does not contain a valid IP address')
  }

  if (version === 4) return address

  const hostname = new URL(`http://[${address}]/`).hostname
  const normalized = hostname.slice(1, -1)
  const [head = '', tail = ''] = normalized.split('::')
  const headSegments = head ? head.split(':') : []
  const tailSegments = tail ? tail.split(':') : []
  const zeroSegments = Array.from(
    { length: 8 - headSegments.length - tailSegments.length },
    () => '0',
  )
  const segments = [...headSegments, ...zeroSegments, ...tailSegments]

  if (
    segments.slice(0, 5).every(segment => Number.parseInt(segment, 16) === 0) &&
    Number.parseInt(segments[5] ?? '', 16) === 0xffff
  ) {
    const high = Number.parseInt(segments[6] ?? '', 16)
    const low = Number.parseInt(segments[7] ?? '', 16)
    return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`
  }

  // IPv6 privacy addresses commonly rotate the lower 64 bits. Limit the
  // stable /64 network instead of allowing each temporary interface address
  // to receive a fresh quota.
  return `${segments
    .slice(0, 4)
    .map(segment => segment.padStart(4, '0'))
    .join(':')}::/64`
}

export function registrationClientIpSource(
  configured?: string,
  required = false,
): RegistrationClientIpSource {
  if (!configured) {
    if (required) {
      throw new Error('REGISTRATION_CLIENT_IP_SOURCE is required outside development')
    }
    return 'x-real-ip'
  }
  if (configured === 'x-real-ip') return configured
  if (configured === 'cf-connecting-ip') return configured

  throw new Error('REGISTRATION_CLIENT_IP_SOURCE must be x-real-ip or cf-connecting-ip')
}

export function fingerprintAddress(
  address: string,
  secret: string,
  scope: RateLimitFingerprintScope = 'registration',
) {
  if (Buffer.byteLength(secret, 'utf8') < MIN_FINGERPRINT_SECRET_BYTES) {
    throw new Error(
      `REGISTRATION_FINGERPRINT_SECRET must contain at least ${MIN_FINGERPRINT_SECRET_BYTES} bytes`,
    )
  }

  const normalizedAddress = normalizeIpAddress(address)
  const digest = createHmac('sha256', secret)
    .update(FINGERPRINT_CONTEXT[scope])
    .update('\0')
    .update(normalizedAddress)
    .digest('hex')

  return `${REGISTRATION_FINGERPRINT_VERSION}:${digest}`
}

export function fingerprintFromHeaders(
  headerStore: Pick<Headers, 'get'>,
  options: {
    clientIpSource?: RegistrationClientIpSource
    secret: string
    fallbackAddress?: string
    scope?: RateLimitFingerprintScope
  },
) {
  const clientIpSource = options.clientIpSource ?? 'x-real-ip'
  const address = headerStore.get(clientIpSource) ?? options.fallbackAddress ?? null

  if (!address) {
    throw new Error(`Trusted client IP header ${clientIpSource} is missing`)
  }

  return fingerprintAddress(address, options.secret, options.scope)
}

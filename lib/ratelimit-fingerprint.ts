import { createHmac } from 'node:crypto'
import { isIP } from 'node:net'

export const REGISTRATION_FINGERPRINT_VERSION = 'v1'
export const MIN_FINGERPRINT_SECRET_BYTES = 32

export type RegistrationClientIpHeader = 'x-real-ip' | 'cf-connecting-ip'

const FINGERPRINT_CONTEXT = 'cs2cup:registration-rate-limit'

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
  return hostname.slice(1, -1)
}

export function registrationClientIpHeader(
  configured?: string,
): RegistrationClientIpHeader {
  if (!configured || configured === 'x-real-ip') return 'x-real-ip'
  if (configured === 'cf-connecting-ip') return configured

  throw new Error(
    'REGISTRATION_CLIENT_IP_HEADER must be x-real-ip or cf-connecting-ip',
  )
}

export function fingerprintAddress(address: string, secret: string) {
  if (Buffer.byteLength(secret, 'utf8') < MIN_FINGERPRINT_SECRET_BYTES) {
    throw new Error(
      `REGISTRATION_FINGERPRINT_SECRET must contain at least ${MIN_FINGERPRINT_SECRET_BYTES} bytes`,
    )
  }

  const normalizedAddress = normalizeIpAddress(address)
  const digest = createHmac('sha256', secret)
    .update(FINGERPRINT_CONTEXT)
    .update('\0')
    .update(normalizedAddress)
    .digest('hex')

  return `${REGISTRATION_FINGERPRINT_VERSION}:${digest}`
}

export function fingerprintFromHeaders(
  headerStore: Pick<Headers, 'get'>,
  options: {
    clientIpHeader?: RegistrationClientIpHeader
    secret: string
    fallbackAddress?: string
  },
) {
  const clientIpHeader = options.clientIpHeader ?? 'x-real-ip'
  const address =
    headerStore.get(clientIpHeader) ??
    options.fallbackAddress ??
    null

  if (!address) {
    throw new Error(`Trusted client IP header ${clientIpHeader} is missing`)
  }

  return fingerprintAddress(address, options.secret)
}

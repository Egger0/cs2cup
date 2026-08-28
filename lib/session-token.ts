import 'server-only'

const SESSION_TOKEN_PREFIX = 'v1.'
const SESSION_TOKEN_BYTES = 32
const SESSION_TOKEN_PAYLOAD_LENGTH = 43
const SESSION_TOKEN_DIGEST_CONTEXT = 'cs2cup-session-v1\0'
const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

// A 32-byte value needs 43 unpadded base64url characters. The final character
// contains four data bits and two zero padding bits, so only every fourth
// alphabet character is canonical.
const CANONICAL_SESSION_TOKEN =
  /^v1\.[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/

function webCrypto() {
  const implementation = globalThis.crypto
  if (!implementation?.subtle || !implementation.getRandomValues) {
    throw new Error('Web Crypto is unavailable')
  }
  return implementation
}

function encodeBase64Url(bytes: Uint8Array) {
  let encoded = ''

  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset] ?? 0
    const second = bytes[offset + 1]
    const third = bytes[offset + 2]

    encoded += BASE64URL_ALPHABET[first >>> 2]
    encoded += BASE64URL_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >>> 4)]

    if (second !== undefined) {
      encoded += BASE64URL_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >>> 6)]
    }
    if (third !== undefined) {
      encoded += BASE64URL_ALPHABET[third & 0x3f]
    }
  }

  return encoded
}

function encodeHex(bytes: Uint8Array) {
  let encoded = ''
  for (const byte of bytes) encoded += byte.toString(16).padStart(2, '0')
  return encoded
}

export function isCanonicalSessionToken(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_SESSION_TOKEN.test(value)
}

export function assertCanonicalSessionToken(
  value: unknown,
): asserts value is string {
  if (!isCanonicalSessionToken(value)) {
    throw new TypeError('Invalid session token')
  }
}

export function generateSessionToken() {
  const random = new Uint8Array(SESSION_TOKEN_BYTES)
  webCrypto().getRandomValues(random)
  const payload = encodeBase64Url(random)

  // Keep the fixed byte/encoding contract visible if this implementation is
  // changed later. This branch does not include token material in its error.
  if (payload.length !== SESSION_TOKEN_PAYLOAD_LENGTH) {
    throw new Error('Session token encoding failed')
  }

  return `${SESSION_TOKEN_PREFIX}${payload}`
}

export async function digestSessionToken(token: string) {
  assertCanonicalSessionToken(token)

  const input = new TextEncoder().encode(
    `${SESSION_TOKEN_DIGEST_CONTEXT}${token}`,
  )
  const digest = await webCrypto().subtle.digest('SHA-256', input)
  return `\\x${encodeHex(new Uint8Array(digest))}`
}

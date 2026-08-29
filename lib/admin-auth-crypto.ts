import { timingSafeEqual } from 'node:crypto'

const encoder = new TextEncoder()

export const ADMIN_PASSWORD_ALGORITHM = 'pbkdf2-hmac-sha256'
export const ADMIN_PASSWORD_ITERATIONS = 600_000
export const ADMIN_PASSWORD_SALT_BYTES = 16
export const ADMIN_PASSWORD_HASH_BYTES = 32
export const ADMIN_AUTH_PEPPER_BYTES = 32
export const ADMIN_SESSION_TOKEN_BYTES = 32
export const ADMIN_PASSWORD_MINIMUM_CHARACTERS = 15
export const ADMIN_PASSWORD_MAXIMUM_BYTES = 1_024
export const ADMIN_USERNAME_MAXIMUM_CHARACTERS = 128

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u
const BASE64URL = /^[A-Za-z0-9_-]+$/
const HEX = /^[0-9a-f]+$/

function byteLength(value: string) {
  return encoder.encode(value).byteLength
}

function webCryptoBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(value.byteLength)
  copy.set(value)
  return copy
}

export function normalizeAdminUsername(value: string) {
  const normalized = value.normalize('NFC').trim()
  if (
    normalized.length === 0 ||
    Array.from(normalized).length > ADMIN_USERNAME_MAXIMUM_CHARACTERS ||
    CONTROL_CHARACTERS.test(normalized)
  ) {
    throw new Error('Administrator username is invalid')
  }
  return normalized
}

export function normalizeAdminPassword(value: string, requireMinimum = false) {
  const normalized = value.normalize('NFC')
  const characters = Array.from(normalized).length
  if (
    normalized.length === 0 ||
    byteLength(normalized) > ADMIN_PASSWORD_MAXIMUM_BYTES ||
    (requireMinimum && characters < ADMIN_PASSWORD_MINIMUM_CHARACTERS)
  ) {
    throw new Error('Administrator password is invalid')
  }
  return normalized
}

export function bytesToHex(value: Uint8Array) {
  return Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('')
}

export function hexToBytes(value: string, expectedBytes?: number) {
  if (
    value.length === 0 ||
    value.length % 2 !== 0 ||
    !HEX.test(value) ||
    (expectedBytes !== undefined && value.length !== expectedBytes * 2)
  ) {
    throw new Error('Hexadecimal value is invalid')
  }
  const result = new Uint8Array(value.length / 2)
  for (let index = 0; index < result.length; index += 1) {
    result[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return result
}

export function bytesToBase64Url(value: Uint8Array) {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

export function base64UrlToBytes(value: string, expectedBytes?: number) {
  if (!value || !BASE64URL.test(value)) throw new Error('Base64url value is invalid')
  const paddingLength = (4 - (value.length % 4)) % 4
  let binary: string
  try {
    binary = atob(
      value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat(paddingLength),
    )
  } catch {
    throw new Error('Base64url value is invalid')
  }
  const result = Uint8Array.from(binary, character => character.charCodeAt(0))
  if (
    (expectedBytes !== undefined && result.byteLength !== expectedBytes) ||
    bytesToBase64Url(result) !== value
  ) {
    throw new Error('Base64url value is invalid')
  }
  return result
}

export function parseAdminAuthPepper(value: string | undefined) {
  if (!value || value !== value.trim()) {
    throw new Error('ADMIN_AUTH_PEPPER is not configured')
  }
  try {
    return base64UrlToBytes(value, ADMIN_AUTH_PEPPER_BYTES)
  } catch {
    throw new Error('ADMIN_AUTH_PEPPER must be an unpadded base64url 32-byte secret')
  }
}

async function hmacSha256(keyBytes: Uint8Array, context: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    webCryptoBytes(keyBytes),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const message = encoder.encode(`${context}\0${value}`)
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, message))
}

export async function deriveAdminPasswordHash(
  password: string,
  salt: Uint8Array,
  pepper: Uint8Array,
  iterations = ADMIN_PASSWORD_ITERATIONS,
) {
  if (salt.byteLength !== ADMIN_PASSWORD_SALT_BYTES) {
    throw new Error('Administrator password salt is invalid')
  }
  if (pepper.byteLength !== ADMIN_AUTH_PEPPER_BYTES) {
    throw new Error('Administrator authentication pepper is invalid')
  }
  if (
    !Number.isInteger(iterations) ||
    iterations !== ADMIN_PASSWORD_ITERATIONS
  ) {
    throw new Error('Administrator password work factor is invalid')
  }

  const normalized = normalizeAdminPassword(password)
  const peppered = await hmacSha256(
    pepper,
    'cs2cup:admin-password:v1',
    normalized,
  )
  const baseKey = await crypto.subtle.importKey('raw', peppered, 'PBKDF2', false, [
    'deriveBits',
  ])
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: webCryptoBytes(salt),
      iterations,
    },
    baseKey,
    ADMIN_PASSWORD_HASH_BYTES * 8,
  )
  return new Uint8Array(derived)
}

export function sameBytes(left: Uint8Array, right: Uint8Array) {
  return left.byteLength === right.byteLength && timingSafeEqual(left, right)
}

export async function digestAdminSessionToken(token: string) {
  const tokenBytes = base64UrlToBytes(token, ADMIN_SESSION_TOKEN_BYTES)
  return new Uint8Array(await crypto.subtle.digest('SHA-256', tokenBytes))
}

export function randomBytes(length: number) {
  if (!Number.isSafeInteger(length) || length < 1 || length > 65_536) {
    throw new Error('Random byte length is invalid')
  }
  const result = new Uint8Array(length)
  crypto.getRandomValues(result)
  return result
}

export function createAdminSessionToken() {
  return bytesToBase64Url(randomBytes(ADMIN_SESSION_TOKEN_BYTES))
}

export async function adminAccountFingerprint(username: string, pepper: Uint8Array) {
  return hmacSha256(pepper, 'cs2cup:admin-login-account:v1', username)
}

export async function adminNetworkFingerprint(address: string, pepper: Uint8Array) {
  return hmacSha256(pepper, 'cs2cup:admin-login-network:v1', address)
}

import 'server-only'

import { base64UrlToBytes, bytesToBase64Url } from '../../opaque-token.ts'

export const PASSWORD_KDF_ALGORITHM = 'pbkdf2-sha256' as const
export const PASSWORD_KDF_VERSION = 1
export const PASSWORD_KDF_ITERATIONS = 600_000
export const PASSWORD_KDF_BYTES = 32
export const PASSWORD_SALT_BYTES = 16

const INPUT_DOMAIN = new TextEncoder().encode('cs2cup/password-input/v1\0')
const VERIFIER_DOMAIN = new TextEncoder().encode('cs2cup/password-verifier/v1\0')
const BASE64URL_32_BYTES = /^[A-Za-z0-9_-]{43}$/
const BASE64URL_16_BYTES = /^[A-Za-z0-9_-]{22}$/

export interface PasswordPepper {
  readonly version: number
  readonly key: Uint8Array
}

export interface PasswordVerifierRecord {
  readonly algorithm: typeof PASSWORD_KDF_ALGORITHM
  readonly algorithmVersion: typeof PASSWORD_KDF_VERSION
  readonly iterations: number
  readonly salt: string
  readonly verifier: string
  readonly pepperVersion: number
}

export interface StoredPasswordVerifier {
  readonly algorithm: string
  readonly parameters_json: string
  readonly salt: ArrayBuffer | Uint8Array
  readonly password_hash: ArrayBuffer | Uint8Array
  readonly pepper_version: number
}

function concatBytes(...parts: readonly Uint8Array[]) {
  const length = parts.reduce((total, part) => total + part.byteLength, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result
}

function uint32(value: number) {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, false)
  return bytes
}

function validPepper(pepper: PasswordPepper) {
  return (
    Number.isSafeInteger(pepper.version) &&
    pepper.version > 0 &&
    pepper.version <= 2_147_483_647 &&
    pepper.key instanceof Uint8Array &&
    pepper.key.byteLength === 32
  )
}

async function pepperKey(pepper: PasswordPepper) {
  if (!validPepper(pepper)) throw new TypeError('Password pepper must be a versioned 32-byte key')
  return crypto.subtle.importKey(
    'raw',
    Uint8Array.from(pepper.key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

async function derive(
  normalizedPassword: string,
  salt: Uint8Array,
  iterations: number,
  hmacKey: CryptoKey,
) {
  const encodedPassword = new TextEncoder().encode(normalizedPassword)
  const pepperedInput = await crypto.subtle.sign(
    'HMAC',
    hmacKey,
    concatBytes(INPUT_DOMAIN, encodedPassword),
  )
  const passwordKey = await crypto.subtle.importKey('raw', pepperedInput, 'PBKDF2', false, [
    'deriveBits',
  ])
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: Uint8Array.from(salt), iterations },
      passwordKey,
      PASSWORD_KDF_BYTES * 8,
    ),
  )
}

function verifierMessage(salt: Uint8Array, iterations: number, derived: Uint8Array) {
  return concatBytes(VERIFIER_DOMAIN, uint32(iterations), salt, derived)
}

function validStoredRecord(record: PasswordVerifierRecord) {
  return (
    record.algorithm === PASSWORD_KDF_ALGORITHM &&
    record.algorithmVersion === PASSWORD_KDF_VERSION &&
    record.iterations >= PASSWORD_KDF_ITERATIONS &&
    record.iterations <= 10_000_000 &&
    Number.isSafeInteger(record.pepperVersion) &&
    record.pepperVersion > 0 &&
    BASE64URL_16_BYTES.test(record.salt) &&
    BASE64URL_32_BYTES.test(record.verifier)
  )
}

function exactBytes(value: ArrayBuffer | Uint8Array, length: number) {
  const bytes =
    value instanceof Uint8Array ? Uint8Array.from(value) : new Uint8Array(value.slice(0))
  return bytes.byteLength === length ? bytes : null
}

export function passwordVerifierForStorage(record: PasswordVerifierRecord): StoredPasswordVerifier {
  if (!validStoredRecord(record)) throw new TypeError('Invalid password verifier record')
  return {
    algorithm: record.algorithm,
    parameters_json: JSON.stringify({
      algorithmVersion: record.algorithmVersion,
      derivedKeyBytes: PASSWORD_KDF_BYTES,
      iterations: record.iterations,
    }),
    salt: base64UrlToBytes(record.salt),
    password_hash: base64UrlToBytes(record.verifier),
    pepper_version: record.pepperVersion,
  }
}

export function passwordVerifierFromStorage(
  stored: StoredPasswordVerifier,
): PasswordVerifierRecord | null {
  if (
    stored.algorithm !== PASSWORD_KDF_ALGORITHM ||
    !Number.isSafeInteger(stored.pepper_version) ||
    stored.pepper_version < 1
  ) {
    return null
  }
  let parameters: unknown
  try {
    parameters = JSON.parse(stored.parameters_json)
  } catch {
    return null
  }
  if (!parameters || Array.isArray(parameters) || typeof parameters !== 'object') return null
  const values = parameters as Record<string, unknown>
  if (
    Object.keys(values).sort().join(',') !== 'algorithmVersion,derivedKeyBytes,iterations' ||
    values.algorithmVersion !== PASSWORD_KDF_VERSION ||
    values.derivedKeyBytes !== PASSWORD_KDF_BYTES ||
    !Number.isSafeInteger(values.iterations)
  ) {
    return null
  }
  const salt = exactBytes(stored.salt, PASSWORD_SALT_BYTES)
  const verifier = exactBytes(stored.password_hash, PASSWORD_KDF_BYTES)
  if (!salt || !verifier) return null
  const record: PasswordVerifierRecord = {
    algorithm: PASSWORD_KDF_ALGORITHM,
    algorithmVersion: PASSWORD_KDF_VERSION,
    iterations: values.iterations as number,
    salt: bytesToBase64Url(salt),
    verifier: bytesToBase64Url(verifier),
    pepperVersion: stored.pepper_version,
  }
  return validStoredRecord(record) ? record : null
}

export async function createPasswordVerifier(
  normalizedPassword: string,
  pepper: PasswordPepper,
): Promise<PasswordVerifierRecord> {
  if (typeof normalizedPassword !== 'string') throw new TypeError('Password must be normalized')
  const key = await pepperKey(pepper)
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES))
  const derived = await derive(normalizedPassword, salt, PASSWORD_KDF_ITERATIONS, key)
  const verifier = await crypto.subtle.sign(
    'HMAC',
    key,
    verifierMessage(salt, PASSWORD_KDF_ITERATIONS, derived),
  )
  return {
    algorithm: PASSWORD_KDF_ALGORITHM,
    algorithmVersion: PASSWORD_KDF_VERSION,
    iterations: PASSWORD_KDF_ITERATIONS,
    salt: bytesToBase64Url(salt),
    verifier: bytesToBase64Url(new Uint8Array(verifier)),
    pepperVersion: pepper.version,
  }
}

export async function verifyPassword(
  normalizedPassword: string,
  record: PasswordVerifierRecord,
  pepper: PasswordPepper,
) {
  if (!validStoredRecord(record) || record.pepperVersion !== pepper.version) return false
  if (!validPepper(pepper)) return false
  try {
    const salt = base64UrlToBytes(record.salt)
    const verifier = base64UrlToBytes(record.verifier)
    const key = await pepperKey(pepper)
    const derived = await derive(normalizedPassword, salt, record.iterations, key)
    return crypto.subtle.verify(
      'HMAC',
      key,
      verifier,
      verifierMessage(salt, record.iterations, derived),
    )
  } catch {
    return false
  }
}

export function passwordVerifierNeedsUpgrade(
  record: PasswordVerifierRecord,
  activePepperVersion: number,
) {
  return (
    record.algorithm !== PASSWORD_KDF_ALGORITHM ||
    record.algorithmVersion !== PASSWORD_KDF_VERSION ||
    record.iterations !== PASSWORD_KDF_ITERATIONS ||
    record.pepperVersion !== activePepperVersion
  )
}

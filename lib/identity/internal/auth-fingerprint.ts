import 'server-only'

import type { AuthAttemptDimension, AuthAttemptOperation } from './auth-attempts.ts'

const FINGERPRINT_DOMAIN = 'cs2cup/auth-attempt-fingerprint/v1'

export interface AuthFingerprintKey {
  readonly version: number
  readonly key: Uint8Array
}

function framedInput(
  operation: AuthAttemptOperation,
  dimension: AuthAttemptDimension,
  value: string,
) {
  const normalizedValue = value.normalize('NFC')
  if (!normalizedValue || new TextEncoder().encode(normalizedValue).byteLength > 512) {
    throw new TypeError('Invalid authentication fingerprint value')
  }
  return new TextEncoder().encode(
    JSON.stringify([FINGERPRINT_DOMAIN, operation, dimension, normalizedValue]),
  )
}

export async function createAuthAttemptFingerprint(
  key: AuthFingerprintKey,
  operation: AuthAttemptOperation,
  dimension: AuthAttemptDimension,
  normalizedValue: string,
) {
  if (
    !Number.isSafeInteger(key.version) ||
    key.version < 1 ||
    key.version > 255 ||
    !(key.key instanceof Uint8Array) ||
    key.key.byteLength !== 32
  ) {
    throw new TypeError('Invalid authentication fingerprint key')
  }
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(key.key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    framedInput(operation, dimension, normalizedValue),
  )
  return {
    fingerprintKeyVersion: key.version,
    fingerprintHash: Array.from(new Uint8Array(digest), byte =>
      byte.toString(16).padStart(2, '0'),
    ).join(''),
  }
}

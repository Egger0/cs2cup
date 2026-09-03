import 'server-only'

import { getCloudflareContext } from '@opennextjs/cloudflare'
import { base64UrlToBytes } from '../../opaque-token.ts'
import type { AuthFingerprintKey } from './auth-fingerprint.ts'
import { deriveIdentitySubkey } from './derived-key.ts'

declare global {
  interface CloudflareEnv {
    IDENTITY_AUTH_FINGERPRINT_KEYS?: string
    IDENTITY_AUTH_FINGERPRINT_ACTIVE_VERSION?: string
    REGISTRATION_FINGERPRINT_SECRET?: string
  }
}

const KEY_VALUE = /^[A-Za-z0-9_-]{43}$/
const VERSION = /^[1-9][0-9]{0,2}$/

export function parseAuthFingerprintKey(raw: unknown, activeVersionRaw: unknown) {
  if (typeof raw !== 'string' || typeof activeVersionRaw !== 'string') {
    throw new Error('Identity authentication fingerprint secret is not configured')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Identity authentication fingerprint configuration is invalid')
  }
  if (
    !parsed ||
    Array.isArray(parsed) ||
    typeof parsed !== 'object' ||
    !VERSION.test(activeVersionRaw)
  ) {
    throw new Error('Identity authentication fingerprint configuration is invalid')
  }
  const entries = Object.entries(parsed)
  if (entries.length < 1 || entries.length > 3) {
    throw new Error('Identity authentication fingerprint configuration is invalid')
  }
  const activeVersion = Number(activeVersionRaw)
  let active: AuthFingerprintKey | null = null
  for (const [version, encoded] of entries) {
    if (!VERSION.test(version) || typeof encoded !== 'string' || !KEY_VALUE.test(encoded)) {
      throw new Error('Identity authentication fingerprint configuration is invalid')
    }
    const key = base64UrlToBytes(encoded)
    if (key.byteLength !== 32) {
      throw new Error('Identity authentication fingerprint configuration is invalid')
    }
    if (Number(version) === activeVersion) {
      active = Object.freeze<AuthFingerprintKey>({
        version: activeVersion,
        key: Uint8Array.from(key),
      })
    }
  }
  if (active) return active
  throw new Error('Identity authentication active fingerprint key is unavailable')
}

export async function activeAuthFingerprintKey() {
  const env = getCloudflareContext().env
  const configured =
    env.IDENTITY_AUTH_FINGERPRINT_KEYS !== undefined ||
    env.IDENTITY_AUTH_FINGERPRINT_ACTIVE_VERSION !== undefined
  if (configured) {
    return parseAuthFingerprintKey(
      env.IDENTITY_AUTH_FINGERPRINT_KEYS,
      env.IDENTITY_AUTH_FINGERPRINT_ACTIVE_VERSION,
    )
  }
  return Object.freeze<AuthFingerprintKey>({
    version: 1,
    key: await deriveIdentitySubkey(
      env.REGISTRATION_FINGERPRINT_SECRET,
      'cs2cup/identity/auth-fingerprint/v1',
    ),
  })
}

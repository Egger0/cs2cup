import 'server-only'

import { getCloudflareContext } from '@opennextjs/cloudflare'
import { base64UrlToBytes } from '../../opaque-token.ts'
import { deriveIdentitySubkey } from './derived-key.ts'
import type { PasswordPepper } from './password-kdf.ts'

declare global {
  interface CloudflareEnv {
    IDENTITY_PASSWORD_PEPPERS?: string
    IDENTITY_PASSWORD_ACTIVE_PEPPER_VERSION?: string
    REGISTRATION_FINGERPRINT_SECRET?: string
  }
}

const PEPPER_VALUE = /^[A-Za-z0-9_-]{43}$/
const VERSION_KEY = /^[1-9][0-9]{0,9}$/

export interface PasswordPepperSet {
  readonly active: PasswordPepper
  readonly byVersion: ReadonlyMap<number, PasswordPepper>
}

export function parsePasswordPepperSet(raw: unknown, activeVersionRaw: unknown): PasswordPepperSet {
  if (typeof raw !== 'string' || typeof activeVersionRaw !== 'string') {
    throw new Error('Identity password pepper secrets are not configured')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Identity password pepper configuration is invalid')
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Identity password pepper configuration is invalid')
  }
  const entries = Object.entries(parsed)
  if (entries.length < 1 || entries.length > 3) {
    throw new Error('Identity password pepper configuration must contain one to three keys')
  }
  const byVersion = new Map<number, PasswordPepper>()
  for (const [versionText, encoded] of entries) {
    if (
      !VERSION_KEY.test(versionText) ||
      typeof encoded !== 'string' ||
      !PEPPER_VALUE.test(encoded)
    ) {
      throw new Error('Identity password pepper configuration is invalid')
    }
    const version = Number(versionText)
    const key = base64UrlToBytes(encoded)
    if (!Number.isSafeInteger(version) || key.byteLength !== 32) {
      throw new Error('Identity password pepper configuration is invalid')
    }
    byVersion.set(version, Object.freeze({ version, key: Uint8Array.from(key) }))
  }
  if (!VERSION_KEY.test(activeVersionRaw)) {
    throw new Error('Identity password active pepper version is invalid')
  }
  const active = byVersion.get(Number(activeVersionRaw))
  if (!active) throw new Error('Identity password active pepper is unavailable')
  return Object.freeze({ active, byVersion })
}

export async function passwordPepperSet() {
  const env = getCloudflareContext().env
  const configured =
    env.IDENTITY_PASSWORD_PEPPERS !== undefined ||
    env.IDENTITY_PASSWORD_ACTIVE_PEPPER_VERSION !== undefined
  if (configured) {
    return parsePasswordPepperSet(
      env.IDENTITY_PASSWORD_PEPPERS,
      env.IDENTITY_PASSWORD_ACTIVE_PEPPER_VERSION,
    )
  }
  const pepper: PasswordPepper = Object.freeze({
    version: 1,
    key: await deriveIdentitySubkey(
      env.REGISTRATION_FINGERPRINT_SECRET,
      'cs2cup/identity/password-pepper/v1',
    ),
  })
  return Object.freeze({ active: pepper, byVersion: new Map([[pepper.version, pepper]]) })
}

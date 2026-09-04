import 'server-only'

import type { PasswordPepper } from './password-kdf.ts'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 16
const VERIFIER_DOMAIN = new TextEncoder().encode('cs2cup/recovery-code/verifier/v1\0')

export const RECOVERY_CODE_COUNT = 10
export const RECOVERY_INTENT_TTL_MS = 5 * 60 * 1000

export class RecoveryCodeError extends Error {
  readonly code:
    | 'invalid_input'
    | 'invalid_code'
    | 'not_authenticated'
    | 'recovery_restricted'
    | 'reauth_required'
    | 'account_setup_required'
    | 'conflict'

  constructor(
    code:
      | 'invalid_input'
      | 'invalid_code'
      | 'not_authenticated'
      | 'recovery_restricted'
      | 'reauth_required'
      | 'account_setup_required'
      | 'conflict',
  ) {
    super(code)
    this.name = 'RecoveryCodeError'
    this.code = code
  }
}

export function exactRecoveryTime(now: number) {
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    now > Number.MAX_SAFE_INTEGER - RECOVERY_INTENT_TTL_MS
  ) {
    throw new TypeError('Invalid recovery-code time')
  }
  return now
}

export function normalizeRecoveryCode(value: unknown) {
  if (typeof value !== 'string' || value.length > 32) return null
  const normalized = value.toUpperCase().replaceAll(/[-\s]/g, '')
  return normalized.length === CODE_LENGTH && [...normalized].every(c => CODE_ALPHABET.includes(c))
    ? normalized
    : null
}

export function createRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH))
  const raw = Array.from(bytes, value => CODE_ALPHABET[value & 31]).join('')
  return raw.match(/.{4}/g)?.join('-') ?? raw
}

export async function recoveryCodeVerifier(normalizedCode: string, pepper: PasswordPepper) {
  const key = await crypto.subtle.importKey(
    'raw',
    Uint8Array.from(pepper.key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const code = new TextEncoder().encode(normalizedCode)
  const message = new Uint8Array(VERIFIER_DOMAIN.length + code.length)
  message.set(VERIFIER_DOMAIN)
  message.set(code, VERIFIER_DOMAIN.length)
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, message))
  return Array.from(digest, value => value.toString(16).padStart(2, '0')).join('')
}

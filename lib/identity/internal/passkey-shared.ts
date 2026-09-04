import 'server-only'

import { bytesToBase64Url, hashOpaqueToken, isOpaqueToken } from '../../opaque-token.ts'
import { OPAQUE_ID, PASSKEY_CREDENTIAL_ID } from './contracts.ts'

export const PASSKEY_INTENT_TTL_MS = 5 * 60 * 1000
export const PASSKEY_INTENT_MAX_ATTEMPTS = 5

const CHALLENGE_DOMAIN = 'cs2cup/identity/passkey-challenge/v1'
const HASH = /^[0-9a-f]{64}$/
const TRANSPORTS = new Set(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'])

export type IdentityPasskeyErrorCode =
  | 'invalid_request'
  | 'invalid_ceremony'
  | 'unknown_credential'
  | 'not_authenticated'
  | 'recovery_restricted'
  | 'reauth_required'
  | 'last_credential'
  | 'not_found'
  | 'conflict'

export class IdentityPasskeyError extends Error {
  readonly code: IdentityPasskeyErrorCode

  constructor(code: IdentityPasskeyErrorCode) {
    super(code)
    this.name = 'IdentityPasskeyError'
    this.code = code
  }
}

export function exactPasskeyTime(now: number) {
  if (!Number.isSafeInteger(now) || now < 0) throw new IdentityPasskeyError('invalid_request')
  return now
}

export async function derivePasskeyChallenge(secret: string) {
  if (!isOpaqueToken(secret)) throw new IdentityPasskeyError('invalid_ceremony')
  const framed = new TextEncoder().encode(`${CHALLENGE_DOMAIN}\0${secret}`)
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', framed)))
}

export async function passkeyCeremonyHashes(secret: string) {
  const challenge = await derivePasskeyChallenge(secret)
  return {
    challenge,
    secretHash: await hashOpaqueToken(secret),
    challengeHash: await hashOpaqueToken(challenge),
  }
}

export function passkeyLabel(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value !== value.trim()) {
    throw new IdentityPasskeyError('invalid_request')
  }
  const normalized = value.normalize('NFC')
  if (
    normalized !== value ||
    Array.from(normalized).length < 1 ||
    Array.from(normalized).length > 80
  ) {
    throw new IdentityPasskeyError('invalid_request')
  }
  return normalized
}

export function passkeyTransports(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 8) {
    throw new IdentityPasskeyError('conflict')
  }
  const transports = value.map(item => {
    if (typeof item !== 'string' || !TRANSPORTS.has(item)) {
      throw new IdentityPasskeyError('conflict')
    }
    return item
  })
  if (new Set(transports).size !== transports.length || JSON.stringify(transports).length > 512) {
    throw new IdentityPasskeyError('conflict')
  }
  return transports
}

export function validPasskeyCredentialId(value: unknown): value is string {
  return typeof value === 'string' && PASSKEY_CREDENTIAL_ID.test(value)
}

export function validOpaqueId(value: unknown): value is string {
  return typeof value === 'string' && OPAQUE_ID.test(value)
}

export function validPasskeyHash(value: unknown): value is string {
  return typeof value === 'string' && HASH.test(value)
}

export function byteView(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? Uint8Array.from(value) : new Uint8Array(value)
  if (bytes.byteLength < 1 || bytes.byteLength > 8192) {
    throw new IdentityPasskeyError('unknown_credential')
  }
  return bytes
}

export function validCounter(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function validDeviceType(value: unknown): value is 'singleDevice' | 'multiDevice' {
  return value === 'singleDevice' || value === 'multiDevice'
}

export function contextJson(value: Readonly<Record<string, unknown>>) {
  const serialized = JSON.stringify(value)
  if (serialized.length > 8192) throw new IdentityPasskeyError('invalid_request')
  return serialized
}

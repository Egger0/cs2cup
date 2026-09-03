import 'server-only'

import { base64UrlToBytes } from '../../opaque-token.ts'
import { VerificationAdapterError, type VerifiedExternalIdentity } from './types.ts'

const PROVIDER_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/
const encoder = new TextEncoder()

export interface IdentityKeyConfig {
  version: number
  key: Uint8Array
}

export function resolveIdentityKeyConfig(input: { version?: number; encodedKey?: string }) {
  const version = input.version ?? 1
  let key: Uint8Array
  try {
    key = base64UrlToBytes(input.encodedKey ?? '')
  } catch (error) {
    throw new VerificationAdapterError('invalid_configuration', error)
  }
  if (
    !Number.isSafeInteger(version) ||
    version < 1 ||
    version > 2_147_483_647 ||
    key.length !== 32
  ) {
    throw new VerificationAdapterError('invalid_configuration')
  }
  return { version, key } satisfies IdentityKeyConfig
}

function identityTuple(
  identity: Pick<VerifiedExternalIdentity, 'provider' | 'issuer' | 'subject'>,
) {
  if (
    !PROVIDER_PATTERN.test(identity.provider) ||
    !identity.issuer ||
    identity.issuer !== identity.issuer.trim() ||
    identity.issuer.length > 500 ||
    !identity.subject ||
    identity.subject !== identity.subject.trim() ||
    identity.subject.length > 500
  ) {
    throw new VerificationAdapterError('invalid_provider_response')
  }
  return JSON.stringify([identity.provider, identity.issuer, identity.subject])
}

export async function hashVerifiedIdentityKey(
  config: IdentityKeyConfig,
  identity: Pick<VerifiedExternalIdentity, 'provider' | 'issuer' | 'subject'>,
) {
  const keyBytes = Uint8Array.from(config.key)
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const payload = encoder.encode(
    `cs2cup.identity-key.v${config.version}\u0000${identityTuple(identity)}`,
  )
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, payload)
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('')
}

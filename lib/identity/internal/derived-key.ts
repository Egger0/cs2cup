import 'server-only'

const MINIMUM_MASTER_SECRET_BYTES = 32

export async function deriveIdentitySubkey(masterSecret: unknown, purpose: string) {
  if (
    typeof masterSecret !== 'string' ||
    new TextEncoder().encode(masterSecret).byteLength < MINIMUM_MASTER_SECRET_BYTES ||
    !/^cs2cup\/[a-z0-9_/-]+\/v[1-9][0-9]*$/.test(purpose)
  ) {
    throw new Error('Identity master secret is not configured')
  }
  const masterKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(masterSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const derived = await crypto.subtle.sign('HMAC', masterKey, new TextEncoder().encode(purpose))
  return new Uint8Array(derived)
}

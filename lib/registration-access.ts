const TOKEN_BYTES = 32
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

function base64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function hex(bytes: Uint8Array) {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export function isRegistrationToken(value: string) {
  return TOKEN_PATTERN.test(value)
}

export async function hashRegistrationToken(token: string) {
  if (!isRegistrationToken(token)) return null
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return hex(new Uint8Array(digest))
}

export async function createRegistrationAccess() {
  const bytes = new Uint8Array(TOKEN_BYTES)
  crypto.getRandomValues(bytes)
  const token = base64Url(bytes)
  const tokenHash = await hashRegistrationToken(token)
  if (!tokenHash) throw new Error('Registration token generation failed')
  return { token, tokenHash }
}

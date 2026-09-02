const TOKEN_BYTES = 32
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/

export function bytesToBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function base64UrlToBytes(value: string) {
  if (!value || !BASE64URL_PATTERN.test(value)) throw new Error('Invalid base64url value')
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + padding)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

export function createOpaqueToken() {
  const bytes = new Uint8Array(TOKEN_BYTES)
  crypto.getRandomValues(bytes)
  return bytesToBase64Url(bytes)
}

export function isOpaqueToken(value: string) {
  return value.length === 43 && BASE64URL_PATTERN.test(value)
}

export async function hashOpaqueToken(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

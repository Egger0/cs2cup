import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { cloudflareEnvironment } from './cloudflare-bindings'

export interface AdminIdentity { uid: string }

const COOKIE_NAME = 'cs2cup_admin'
const SESSION_MAX_AGE = 60 * 60 * 8

function base64Url(bytes: Uint8Array) {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function fromBase64Url(value: string) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)
  const decoded = atob(padded)
  return Uint8Array.from(decoded, character => character.charCodeAt(0))
}

async function signingKey(secret: string) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

async function sign(payload: string, secret: string) {
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(secret), new TextEncoder().encode(payload))))
}

function configuredAdmin() {
  const env = cloudflareEnvironment()
  const username = env.ADMIN_USERNAME?.trim()
  const password = env.ADMIN_PASSWORD
  const sessionSecret = env.ADMIN_SESSION_SECRET
  return username && password && sessionSecret ? { username, password, sessionSecret } : null
}

function sameValue(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

export async function credentialsAccepted(username: string, password: string) {
  const configured = configuredAdmin()
  if (!configured) return false
  const encoder = new TextEncoder()
  const [submitted, expected] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(`${username}\u0000${password}`)),
    crypto.subtle.digest('SHA-256', encoder.encode(`${configured.username}\u0000${configured.password}`)),
  ])
  return sameValue(new Uint8Array(submitted), new Uint8Array(expected))
}

export async function startAdminSession(username: string) {
  const configured = configuredAdmin()
  if (!configured || username !== configured.username) throw new Error('Admin login is not configured')
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({ username, expiresAt: Date.now() + SESSION_MAX_AGE * 1000 })))
  const signature = await sign(payload, configured.sessionSecret)
  ;(await cookies()).set(COOKIE_NAME, `${payload}.${signature}`, {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE,
    path: '/',
    sameSite: 'lax',
    secure: true,
  })
}

export async function endAdminSession() {
  ;(await cookies()).delete(COOKIE_NAME)
}

export const getCurrentAdmin = cache(async (): Promise<AdminIdentity | null> => {
  const configured = configuredAdmin()
  const session = (await cookies()).get(COOKIE_NAME)?.value
  if (!configured || !session) return null

  const [payload, signature] = session.split('.')
  if (!payload || !signature) return null

  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await signingKey(configured.sessionSecret),
      fromBase64Url(signature),
      new TextEncoder().encode(payload),
    )
    if (!valid) return null
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as { username?: unknown; expiresAt?: unknown }
    if (parsed.username !== configured.username || !Number.isSafeInteger(parsed.expiresAt) || parsed.expiresAt <= Date.now()) return null
    return { uid: configured.username }
  } catch {
    return null
  }
})

export async function requireAdmin(): Promise<AdminIdentity> {
  const admin = await getCurrentAdmin()
  if (!admin) redirect('/admin/login')
  return admin
}

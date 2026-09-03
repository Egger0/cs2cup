import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { cloudflareBindings } from './cloudflare-bindings'
import type { AdminLoginAdmission } from './queries/admin-login-attempts'

interface AdminIdentity {
  uid: string
}

interface AdminAccount {
  id: number
  username: string
  password_salt: string
  password_hash: string
}

interface AdminSession {
  username: string
}

const COOKIE_NAME = 'cs2cup_admin'
const SESSION_MAX_AGE = 60 * 60 * 8

function base64Url(bytes: Uint8Array) {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function sameValue(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }
  return difference === 0
}

async function hash(value: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

async function getAdminAccount() {
  return cloudflareBindings()
    .db.prepare('SELECT id, username, password_salt, password_hash FROM admin_account WHERE id = 1')
    .bind()
    .first<AdminAccount>()
}

export async function credentialsAccepted(username: string, password: string) {
  const admin = await getAdminAccount()
  if (!admin) return false
  const [submittedUsername, expectedUsername, submittedPassword] = await Promise.all([
    hash(username),
    hash(admin.username),
    hash(`${admin.password_salt}\0${password}`),
  ])
  return (
    sameValue(submittedUsername, expectedUsername) &&
    sameValue(
      new TextEncoder().encode(hex(submittedPassword)),
      new TextEncoder().encode(admin.password_hash),
    )
  )
}

export async function createAdminSession(username: string, admission: AdminLoginAdmission) {
  const admin = await getAdminAccount()
  if (!admin || !sameValue(await hash(username), await hash(admin.username))) {
    throw new Error('Admin login is not configured')
  }
  const tokenBytes = new Uint8Array(32)
  crypto.getRandomValues(tokenBytes)
  const token = base64Url(tokenBytes)
  const db = cloudflareBindings().db
  await db.batch([
    db.prepare('DELETE FROM admin_session WHERE expires_at <= ?').bind(Date.now()),
    db
      .prepare('INSERT INTO admin_session (token_hash, admin_id, expires_at) VALUES (?, ?, ?)')
      .bind(hex(await hash(token)), admin.id, Date.now() + SESSION_MAX_AGE * 1000),
    db
      .prepare('DELETE FROM admin_login_attempt WHERE bucket_start = ? AND fingerprint = ?')
      .bind(admission.bucketStart, admission.fingerprint),
  ])
  return token
}

export const adminSessionCookie = {
  name: COOKIE_NAME,
  maxAge: SESSION_MAX_AGE,
  options: { httpOnly: true, path: '/', sameSite: 'lax' as const, secure: true },
}

export async function endAdminSession() {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  if (token) {
    await cloudflareBindings()
      .db.prepare('DELETE FROM admin_session WHERE token_hash = ?')
      .bind(hex(await hash(token)))
      .run()
  }
  ;(await cookies()).delete(COOKIE_NAME)
}

export const getCurrentAdmin = cache(async (): Promise<AdminIdentity | null> => {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  if (!token) return null
  const session = await cloudflareBindings()
    .db.prepare(
      'SELECT a.username FROM admin_session s JOIN admin_account a ON a.id = s.admin_id WHERE s.token_hash = ? AND s.expires_at > ?',
    )
    .bind(hex(await hash(token)), Date.now())
    .first<AdminSession>()
  return session ? { uid: session.username } : null
})

export async function requireAdmin(): Promise<AdminIdentity> {
  const admin = await getCurrentAdmin()
  if (!admin) redirect('/admin/login')
  return admin
}

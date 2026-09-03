import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { hasStaffCapability } from './authorization'
import { cloudflareBindings } from './cloudflare-bindings'
import { getCurrentParticipant, participantSessionCookie } from './participant-auth'
import type { StaffActor, TournamentStaffCapability } from './authorization'
import type { AdminLoginAdmission } from './queries/admin-login-attempts'

export interface AdminIdentity {
  adminId: number
  uid: string
}

export type TournamentStaffIdentity =
  | ({ kind: 'admin'; sessionExpiresAt: number } & AdminIdentity)
  | { kind: 'participant'; principalId: string; sessionExpiresAt: number }

export type TournamentStaffAccess =
  | { ok: true; actor: TournamentStaffIdentity }
  | {
      ok: false
      reason: 'anonymous' | 'expired' | 'forbidden'
      hadAdminCookie: boolean
      hadParticipantCookie: boolean
    }

export class TournamentStaffAccessError extends Error {
  readonly access: Extract<TournamentStaffAccess, { ok: false }>

  constructor(access: Extract<TournamentStaffAccess, { ok: false }>) {
    super('Tournament staff authorization failed')
    this.name = 'TournamentStaffAccessError'
    this.access = access
  }
}

export function staffSessionRemainingMs(expiresAt: number) {
  return Number.isSafeInteger(expiresAt) ? expiresAt - Date.now() : 0
}

interface AdminAccount {
  id: number
  username: string
  password_salt: string
  password_hash: string
}

interface AdminSession {
  admin_id: number
  username: string
  expires_at: number
}

interface AdminSessionIdentity extends AdminIdentity {
  sessionExpiresAt: number
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

const getCurrentAdminSessionIdentity = cache(async (): Promise<AdminSessionIdentity | null> => {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  if (!token) return null
  const session = await cloudflareBindings()
    .db.prepare(
      'SELECT a.id AS admin_id, a.username, s.expires_at FROM admin_session s JOIN admin_account a ON a.id = s.admin_id WHERE s.token_hash = ? AND s.expires_at > ?',
    )
    .bind(hex(await hash(token)), Date.now())
    .first<AdminSession>()
  return session
    ? {
        adminId: session.admin_id,
        uid: session.username,
        sessionExpiresAt: session.expires_at,
      }
    : null
})

const currentAdminCanManagePlatform = cache((adminId: number) =>
  hasStaffCapability(cloudflareBindings().db, { kind: 'admin', adminId }, 'platform.manage', {
    kind: 'platform',
  }),
)

export const getCurrentPlatformOwner = cache(async (): Promise<AdminIdentity | null> => {
  const admin = await getCurrentAdminSessionIdentity()
  if (!admin || !(await currentAdminCanManagePlatform(admin.adminId))) return null
  return { adminId: admin.adminId, uid: admin.uid }
})

export async function getCurrentTournamentStaffAccess(
  tournamentId: number,
  capability: TournamentStaffCapability,
): Promise<TournamentStaffAccess> {
  const cookieStore = await cookies()
  const hadAdminCookie = Boolean(cookieStore.get(adminSessionCookie.name)?.value)
  const hadParticipantCookie = Boolean(cookieStore.get(participantSessionCookie.name)?.value)
  const [participant, admin] = await Promise.all([
    getCurrentParticipant(),
    getCurrentAdminSessionIdentity(),
  ])
  const db = cloudflareBindings().db
  const resource = { kind: 'tournament' as const, tournamentId }
  const now = Date.now()

  if (participant) {
    const actor: StaffActor = { kind: 'participant', principalId: participant.principalId }
    if (await hasStaffCapability(db, actor, capability, resource, now)) {
      return {
        ok: true,
        actor: {
          ...actor,
          sessionExpiresAt: participant.sessionExpiresAt,
        },
      }
    }
  }

  if (admin) {
    const actor: StaffActor = { kind: 'admin', adminId: admin.adminId }
    if (await hasStaffCapability(db, actor, capability, resource, now)) {
      return {
        ok: true,
        actor: { ...actor, uid: admin.uid, sessionExpiresAt: admin.sessionExpiresAt },
      }
    }
  }

  return {
    ok: false,
    reason:
      participant || admin
        ? 'forbidden'
        : hadAdminCookie || hadParticipantCookie
          ? 'expired'
          : 'anonymous',
    hadAdminCookie,
    hadParticipantCookie,
  }
}

export async function requireTournamentStaffCapability(
  tournamentId: number,
  capability: TournamentStaffCapability,
) {
  const access = await getCurrentTournamentStaffAccess(tournamentId, capability)
  if (!access.ok) throw new TournamentStaffAccessError(access)
  return access.actor
}

export async function requireAdmin(): Promise<AdminIdentity> {
  const admin = await getCurrentAdminSessionIdentity()
  if (!admin) redirect('/admin/login')
  if (!(await currentAdminCanManagePlatform(admin.adminId))) notFound()
  return { adminId: admin.adminId, uid: admin.uid }
}

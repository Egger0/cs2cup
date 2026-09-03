import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { hasStaffCapability } from './authorization'
import { cloudflareBindings } from './cloudflare-bindings'
import { LEGACY_ADMIN_SESSION_MAX_AGE } from './legacy-admin-session-issuer'
import {
  authorize as authorizeIdentity,
  getAuthContext,
  type AuthenticatedAuthContext,
} from './identity/kernel'
import {
  getCurrentLegacyParticipantSession,
  LEGACY_ADMIN_SESSION_COOKIE,
  participantSessionCookie,
} from './participant-auth'
import { hashOpaqueToken, isOpaqueToken } from './opaque-token.ts'
import type { StaffActor, TournamentStaffCapability } from './authorization'
import type { NextResponse } from 'next/server'

export {
  createAdminSession,
  credentialsAccepted,
  LegacySessionConflictError,
} from './legacy-admin-session-issuer'

export interface AdminIdentity {
  adminId: number
  uid: string
}

export interface UnifiedPlatformOwnerIdentity {
  accountId: string
  uid: string
}

export type PlatformConsoleIdentity =
  | ({ kind: 'unified' } & UnifiedPlatformOwnerIdentity)
  | ({ kind: 'legacy' } & AdminIdentity)

export type TournamentStaffIdentity =
  | ({ kind: 'admin'; sessionExpiresAt: number } & AdminIdentity)
  | { kind: 'participant'; principalId: string; sessionExpiresAt: number }

export type TournamentStaffAccess =
  | { ok: true; actor: TournamentStaffIdentity }
  | {
      ok: false
      reason: 'anonymous' | 'expired' | 'forbidden' | 'conflict'
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

interface AdminSession {
  admin_id: number
  username: string
  expires_at: number
}

interface AdminSessionIdentity extends AdminIdentity {
  sessionExpiresAt: number
}

const COOKIE_NAME = LEGACY_ADMIN_SESSION_COOKIE
const SESSION_MAX_AGE = LEGACY_ADMIN_SESSION_MAX_AGE

export const adminSessionCookie = {
  name: COOKIE_NAME,
  maxAge: SESSION_MAX_AGE,
  options: { httpOnly: true, path: '/', sameSite: 'lax' as const, secure: true },
}

export function clearAdminSessionCookie(response: NextResponse) {
  response.cookies.set(COOKIE_NAME, '', {
    ...adminSessionCookie.options,
    maxAge: 0,
  })
  return response
}

export async function endLegacySessions() {
  const cookieStore = await cookies()
  const adminToken = cookieStore.get(COOKIE_NAME)?.value
  const participantToken = cookieStore.get(participantSessionCookie.name)?.value
  const db = cloudflareBindings().db
  const deletions = []
  if (adminToken) {
    deletions.push(
      db
        .prepare('DELETE FROM admin_session WHERE token_hash = ?')
        .bind(await hashOpaqueToken(adminToken)),
    )
  }
  if (participantToken && isOpaqueToken(participantToken)) {
    deletions.push(
      db
        .prepare('DELETE FROM participant_session WHERE token_hash = ?')
        .bind(await hashOpaqueToken(participantToken)),
    )
  }
  if (deletions.length > 0) await db.batch(deletions)
  cookieStore.set(COOKIE_NAME, '', { ...adminSessionCookie.options, maxAge: 0 })
  cookieStore.set(participantSessionCookie.name, '', {
    ...participantSessionCookie.options,
    maxAge: 0,
  })
}

const getCurrentAdminSessionIdentity = cache(async (): Promise<AdminSessionIdentity | null> => {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  if (!token) return null
  const session = await cloudflareBindings()
    .db.prepare(
      'SELECT a.id AS admin_id, a.username, s.expires_at FROM admin_session s JOIN admin_account a ON a.id = s.admin_id WHERE s.token_hash = ? AND s.expires_at > ?',
    )
    .bind(await hashOpaqueToken(token), Date.now())
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

async function unifiedPlatformDecision(context: AuthenticatedAuthContext) {
  return authorizeIdentity(context, 'platform.configure', { kind: 'platform' })
}

export const getCurrentUnifiedPlatformOwner = cache(
  async (): Promise<UnifiedPlatformOwnerIdentity | null> => {
    const context = await getAuthContext()
    if (context.kind === 'anonymous' || !(await unifiedPlatformDecision(context)).ok) return null
    return { accountId: context.account.id, uid: context.account.displayName }
  },
)

export const hasUnifiedPlatformOwnerProvisioned = cache(async () => {
  const row = await cloudflareBindings()
    .db.prepare(
      `SELECT 1 AS present FROM identity_role_assignment
       WHERE role = 'platform_owner' AND scope_type = 'platform' AND revoked_at IS NULL LIMIT 1`,
    )
    .bind()
    .first<{ present: number }>()
  return row?.present === 1
})

export const getCurrentPlatformOwner = cache(async (): Promise<AdminIdentity | null> => {
  const [admin, participant] = await Promise.all([
    getCurrentAdminSessionIdentity(),
    getCurrentLegacyParticipantSession(),
  ])
  if (!admin || participant || !(await currentAdminCanManagePlatform(admin.adminId))) return null
  return { adminId: admin.adminId, uid: admin.uid }
})

export async function hasConflictingLegacySessions() {
  const [admin, participant] = await Promise.all([
    getCurrentAdminSessionIdentity(),
    getCurrentLegacyParticipantSession(),
  ])
  return Boolean(admin && participant)
}

export async function hasCurrentLegacyAdminSession() {
  return Boolean(await getCurrentAdminSessionIdentity())
}

export async function getCurrentTournamentStaffAccess(
  tournamentId: number,
  capability: TournamentStaffCapability,
): Promise<TournamentStaffAccess> {
  const cookieStore = await cookies()
  const hadAdminCookie = Boolean(cookieStore.get(adminSessionCookie.name)?.value)
  const hadParticipantCookie = Boolean(cookieStore.get(participantSessionCookie.name)?.value)
  const [participant, admin] = await Promise.all([
    getCurrentLegacyParticipantSession(),
    getCurrentAdminSessionIdentity(),
  ])
  const db = cloudflareBindings().db
  const resource = { kind: 'tournament' as const, tournamentId }
  const now = Date.now()

  if (participant && admin) {
    return {
      ok: false,
      reason: 'conflict',
      hadAdminCookie,
      hadParticipantCookie,
    }
  }

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

export async function requireAdmin(): Promise<PlatformConsoleIdentity> {
  const context = await getAuthContext()
  if (context.kind === 'authenticated') {
    const decision = await unifiedPlatformDecision(context)
    if (decision.ok) {
      return { kind: 'unified', accountId: context.account.id, uid: context.account.displayName }
    }
    if (decision.reason === 'assurance_required') {
      redirect('/login?redirectKey=workspaces&reauth=1')
    }
    notFound()
  }
  const [admin, participant] = await Promise.all([
    getCurrentAdminSessionIdentity(),
    getCurrentLegacyParticipantSession(),
  ])
  if (!admin) redirect('/admin/login')
  if (participant) redirect('/login?reason=conflict&reauth=admin')
  if (!(await currentAdminCanManagePlatform(admin.adminId))) notFound()
  redirect('/admin/bootstrap')
}

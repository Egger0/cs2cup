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
import { IDENTITY_SESSION_COOKIE_NAME } from './identity/internal/cookie.ts'
import {
  resolveUnifiedConsolePermissions,
  type AdminIdentity,
  type PlatformConsoleAccess,
  type PlatformConsoleIdentity,
  type UnifiedPlatformOwnerIdentity,
} from './identity/console-access'
import {
  getCurrentLegacyParticipantSession,
  LEGACY_ADMIN_SESSION_COOKIE,
  participantSessionCookie,
} from './participant-auth'
import { getCurrentLegacyAdminSessionIdentity as getCurrentAdminSessionIdentity } from './legacy-admin-session'
import { hashOpaqueToken, isOpaqueToken } from './opaque-token.ts'
import { TournamentStaffAccessError, type TournamentStaffAccess } from './tournament-staff-access'
import type { StaffActor, TournamentStaffCapability } from './authorization'
import type { NextResponse } from 'next/server'

export {
  createAdminSession,
  credentialsAccepted,
  LegacySessionConflictError,
} from './legacy-admin-session-issuer'
export type {
  AdminIdentity,
  PlatformConsoleAccess,
  PlatformConsoleCapability,
  PlatformConsoleIdentity,
  UnifiedPlatformOwnerIdentity,
} from './identity/console-access'
export {
  staffSessionRemainingMs,
  TournamentStaffAccessError,
  type TournamentStaffAccess,
  type TournamentStaffIdentity,
} from './tournament-staff-access'

export const adminSessionCookie = {
  name: LEGACY_ADMIN_SESSION_COOKIE,
  maxAge: LEGACY_ADMIN_SESSION_MAX_AGE,
  options: { httpOnly: true, path: '/', sameSite: 'lax' as const, secure: true },
}

export function clearAdminSessionCookie(response: NextResponse) {
  response.cookies.set(LEGACY_ADMIN_SESSION_COOKIE, '', {
    ...adminSessionCookie.options,
    maxAge: 0,
  })
  return response
}

export async function endLegacySessions() {
  const cookieStore = await cookies()
  const adminToken = cookieStore.get(LEGACY_ADMIN_SESSION_COOKIE)?.value
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
  cookieStore.set(LEGACY_ADMIN_SESSION_COOKIE, '', { ...adminSessionCookie.options, maxAge: 0 })
  cookieStore.set(participantSessionCookie.name, '', {
    ...participantSessionCookie.options,
    maxAge: 0,
  })
}

const currentAdminCanManagePlatform = cache((adminId: number) =>
  hasStaffCapability(cloudflareBindings().db, { kind: 'admin', adminId }, 'platform.manage', {
    kind: 'platform',
  }),
)

async function unifiedPlatformDecision(context: AuthenticatedAuthContext) {
  return authorizeIdentity(context, 'platform.configure', { kind: 'platform' })
}

async function unifiedConsoleAccess(
  context: AuthenticatedAuthContext,
): Promise<PlatformConsoleAccess | null> {
  const result = await resolveUnifiedConsolePermissions(cloudflareBindings().db, context)
  if (!result.ok) {
    if (result.reason === 'reauthentication_required') {
      redirect('/login?redirectKey=workspaces&reauth=1')
    }
    return null
  }
  return {
    kind: 'unified',
    accountId: context.account.id,
    uid: context.account.displayName,
    ...result.permissions,
  }
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

async function requireLegacyPlatformTransition(): Promise<never> {
  const [admin, participant] = await Promise.all([
    getCurrentAdminSessionIdentity(),
    getCurrentLegacyParticipantSession(),
  ])
  if (!admin) redirect('/admin/login')
  if (participant) redirect('/login?reason=conflict&reauth=admin')
  if (!(await currentAdminCanManagePlatform(admin.adminId))) notFound()
  redirect('/admin/bootstrap')
}

export async function getCurrentTournamentStaffAccess(
  tournamentId: number,
  capability: TournamentStaffCapability,
): Promise<TournamentStaffAccess> {
  const cookieStore = await cookies()
  const hadAdminCookie = Boolean(cookieStore.get(adminSessionCookie.name)?.value)
  const hadParticipantCookie = Boolean(cookieStore.get(participantSessionCookie.name)?.value)
  const unifiedToken = cookieStore.get(IDENTITY_SESSION_COOKIE_NAME)?.value ?? null
  const hadUnifiedCookie = Boolean(unifiedToken)
  const db = cloudflareBindings().db
  const [participant, admin, unified] = await Promise.all([
    getCurrentLegacyParticipantSession(),
    getCurrentAdminSessionIdentity(),
    getAuthContext({ database: db, token: unifiedToken }),
  ])
  const resource = { kind: 'tournament' as const, tournamentId }
  const now = Date.now()

  if ((participant && admin) || (unified.kind === 'authenticated' && (participant || admin))) {
    return {
      ok: false,
      reason: 'conflict',
      hadAdminCookie,
      hadParticipantCookie,
    }
  }

  if (unified.kind === 'authenticated') {
    const decision = await authorizeIdentity(
      unified,
      capability,
      { kind: 'tournament', tournamentId },
      { database: db, now },
    )
    if (decision.ok) {
      return {
        ok: true,
        actor: {
          kind: 'unified',
          accountId: unified.account.id,
          uid: unified.account.displayName,
          sessionExpiresAt: Math.min(
            unified.session.idleExpiresAt,
            unified.session.absoluteExpiresAt,
          ),
        },
      }
    }
    return {
      ok: false,
      reason:
        decision.reason === 'session_invalid' || decision.reason === 'assurance_required'
          ? 'expired'
          : 'forbidden',
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
        : hadAdminCookie || hadParticipantCookie || hadUnifiedCookie
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
  return requireLegacyPlatformTransition()
}

export async function requirePlatformConsole(): Promise<PlatformConsoleAccess> {
  const context = await getAuthContext()
  if (context.kind === 'authenticated') {
    const access = await unifiedConsoleAccess(context)
    if (access) return access
    notFound()
  }
  return requireLegacyPlatformTransition()
}

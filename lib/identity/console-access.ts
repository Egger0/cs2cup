import 'server-only'

import { authorize } from './internal/authorization.ts'
import type { AuthenticatedAuthContext, IdentityDatabase } from './internal/contracts.ts'
import { STAFF_RECENT_AUTH_MAX_AGE_MS, type IdentityCapability } from './internal/policy.ts'

export type PlatformConsoleCapability = Extract<
  IdentityCapability,
  'platform.configure' | 'platform.access.manage' | 'platform.identity.review'
>

export interface UnifiedConsolePermissions {
  readonly capabilities: readonly PlatformConsoleCapability[]
  readonly hasTournamentWork: boolean
  readonly holdsReviewRole: boolean
}

export interface UnifiedPlatformOwnerIdentity {
  readonly accountId: string
  readonly uid: string
}

export type PlatformConsoleIdentity = { kind: 'unified' } & UnifiedPlatformOwnerIdentity

export type PlatformConsoleAccess = PlatformConsoleIdentity & UnifiedConsolePermissions

const CAPABILITIES: readonly PlatformConsoleCapability[] = [
  'platform.configure',
  'platform.access.manage',
  'platform.identity.review',
]

export async function resolveUnifiedConsolePermissions(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  now = Date.now(),
) {
  const decisions = await Promise.all(
    CAPABILITIES.map(capability =>
      authorize(database, context, capability, { kind: 'platform' }, undefined, now),
    ),
  )
  const capabilities = CAPABILITIES.filter((_, index) => decisions[index]?.ok)
  const tournamentSessionAssured =
    !context.session.recoveryRestricted &&
    context.session.authenticatedAt >= now - STAFF_RECENT_AUTH_MAX_AGE_MS
  const held = (scope: 'tournament' | 'platform', roles: readonly string[]) =>
    database
      .prepare(
        `SELECT 1 AS present FROM identity_role_assignment
         WHERE account_id = ? AND scope_type = '${scope}'
           AND role IN (${roles.map(() => '?').join(', ')})
           AND revoked_at IS NULL AND granted_at <= ?
           AND (expires_at IS NULL OR expires_at > ?) LIMIT 1`,
      )
      .bind(context.account.id, ...roles, now, now)
      .first<{ present: number }>()
  const [role, reviewRole] = await Promise.all([
    held('tournament', ['organizer', 'referee', 'check_in_operator']),
    held('platform', ['platform_owner', 'identity_reviewer']),
  ])
  if (capabilities.length || (role && tournamentSessionAssured)) {
    return {
      ok: true,
      permissions: {
        capabilities,
        hasTournamentWork: Boolean(role),
        holdsReviewRole: Boolean(reviewRole),
      },
    } as const
  }
  if (
    role ||
    reviewRole ||
    decisions.some(decision => !decision.ok && decision.reason === 'assurance_required')
  ) {
    return { ok: false, reason: 'reauthentication_required' } as const
  }
  return { ok: false, reason: 'forbidden' } as const
}

import 'server-only'

export const STAFF_CAPABILITIES = [
  'platform.manage',
  'tournament.view',
  'tournament.configure',
  'tournament.entries.review',
  'tournament.entries.export',
  'tournament.check_in.read',
  'tournament.check_in.write',
  'tournament.bracket.manage',
  'tournament.schedule.manage',
  'tournament.results.write',
  'tournament.media.manage',
] as const

export type StaffCapability = (typeof STAFF_CAPABILITIES)[number]
export type TournamentStaffCapability = Exclude<StaffCapability, 'platform.manage'>
export type StaffRole = 'platform_owner' | 'organizer' | 'referee' | 'check_in_operator'
export type StaffActor =
  | { kind: 'admin'; adminId: number }
  | { kind: 'participant'; principalId: string }
export type StaffResource = { kind: 'platform' } | { kind: 'tournament'; tournamentId: number }

interface AuthorizationStatement {
  first<Type>(): Promise<Type | null>
}

export interface AuthorizationDatabase {
  prepare(query: string): {
    bind(...values: unknown[]): AuthorizationStatement
  }
}

const TOURNAMENT_CAPABILITIES = STAFF_CAPABILITIES.filter(
  capability => capability !== 'platform.manage',
)

const ROLE_CAPABILITIES: Record<StaffRole, readonly StaffCapability[]> = {
  platform_owner: STAFF_CAPABILITIES,
  organizer: TOURNAMENT_CAPABILITIES,
  referee: ['tournament.view', 'tournament.results.write'],
  check_in_operator: ['tournament.view', 'tournament.check_in.read', 'tournament.check_in.write'],
}

const PARTICIPANT_ID = /^p_[A-Za-z0-9_-]{43}$/
const STAFF_ROLES = Object.keys(ROLE_CAPABILITIES) as StaffRole[]

function isStaffCapability(value: string): value is StaffCapability {
  return STAFF_CAPABILITIES.some(capability => capability === value)
}

function validRequest(
  actor: StaffActor,
  capability: StaffCapability,
  resource: StaffResource,
  now: number,
) {
  if (!Number.isSafeInteger(now) || now < 0 || !isStaffCapability(capability)) return false
  if (
    capability === 'platform.manage' ? resource.kind !== 'platform' : resource.kind !== 'tournament'
  ) {
    return false
  }
  if (resource.kind === 'tournament' && !validId(resource.tournamentId)) return false
  return actor.kind === 'admin' ? validId(actor.adminId) : PARTICIPANT_ID.test(actor.principalId)
}

function validId(value: number) {
  return Number.isSafeInteger(value) && value > 0
}

export function staffRoleAllows(role: string, capability: StaffCapability) {
  if (!STAFF_ROLES.includes(role as StaffRole) || !isStaffCapability(capability)) return false
  return ROLE_CAPABILITIES[role as StaffRole].includes(capability)
}

export function participantRolesForCapability(capability: TournamentStaffCapability) {
  return STAFF_ROLES.filter(
    role => role !== 'platform_owner' && staffRoleAllows(role, capability),
  ) as Exclude<StaffRole, 'platform_owner'>[]
}

export async function hasStaffCapability(
  db: AuthorizationDatabase,
  actor: StaffActor,
  capability: StaffCapability,
  resource: StaffResource,
  now = Date.now(),
) {
  if (!validRequest(actor, capability, resource, now)) return false

  if (actor.kind === 'admin') {
    if (!staffRoleAllows('platform_owner', capability)) return false
    const row = await db
      .prepare(
        `SELECT 1 AS allowed
         FROM platform_role_assignment
         WHERE admin_id = ?
           AND role = 'platform_owner'
           AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > ?)
           AND NOT EXISTS (
             SELECT 1 FROM identity_legacy_subject_map AS migrated
             WHERE migrated.subject_type = 'admin_account'
               AND migrated.subject_id = CAST(platform_role_assignment.admin_id AS TEXT)
           )
         LIMIT 1`,
      )
      .bind(actor.adminId, now)
      .first<{ allowed: number }>()
    return row?.allowed === 1
  }

  if (resource.kind !== 'tournament') return false
  const roles = participantRolesForCapability(capability as TournamentStaffCapability)
  if (!roles.length) return false
  const placeholders = roles.map(() => '?').join(', ')
  const row = await db
    .prepare(
      `SELECT 1 AS allowed
       FROM tournament_role_assignment
       WHERE principal_id = ?
         AND tournament_id = ?
         AND role IN (${placeholders})
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > ?)
         AND NOT EXISTS (
           SELECT 1 FROM identity_legacy_subject_map AS migrated
           WHERE migrated.subject_type = 'participant_principal'
             AND migrated.subject_id = tournament_role_assignment.principal_id
         )
       LIMIT 1`,
    )
    .bind(actor.principalId, resource.tournamentId, ...roles, now)
    .first<{ allowed: number }>()
  return row?.allowed === 1
}

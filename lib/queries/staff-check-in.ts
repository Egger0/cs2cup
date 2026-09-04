import 'server-only'

import { requireTournamentStaffCapability, type TournamentStaffIdentity } from '../auth'
import { participantRolesForCapability } from '../authorization'
import { cloudflareBindings } from '../cloudflare-bindings'
import { getAuthContext } from '../identity/kernel'
import { STAFF_RECENT_AUTH_MAX_AGE_MS, type IdentityRole } from '../identity/internal/policy'
import { getCurrentParticipant } from '../participant-auth'
import type { TournamentStatus } from '../types'

interface TournamentRow {
  id: number
  slug?: string
  title: string
  season: string
  edition: number
  status: TournamentStatus
}

interface CheckInTeamRow {
  id: number
  tournament_id: number
  name: string
  tag: string
  captain: string
  dept: string | null
  checked_in_at: string | null
}

export interface TournamentCheckInTeam {
  id: number
  tournamentId: number
  name: string
  tag: string
  captain: string
  dept: string | null
  checkedInAt: string | null
}

export type ParticipantCheckInWorkspace = TournamentRow

export interface UnifiedTournamentWorkspace {
  readonly id: number
  readonly slug: string
  readonly title: string
  readonly season: string
  readonly edition: number
  readonly status: TournamentStatus
  readonly roles: readonly Exclude<IdentityRole, 'platform_owner' | 'identity_reviewer'>[]
  readonly canCheckIn: boolean
}

export interface TournamentWorkspacePage<T> {
  readonly workspaces: readonly T[]
  readonly total: number
  readonly pagination: {
    readonly offset: number
    readonly limit: number
    readonly hasPrevious: boolean
    readonly hasNext: boolean
  }
}

interface WorkspaceListOptions {
  readonly limit?: number
  readonly offset?: number
  readonly checkInOnly?: boolean
}

export interface TournamentCheckInDesk {
  actor: TournamentStaffIdentity
  tournament: TournamentRow
  teams: TournamentCheckInTeam[]
}

function checkInTeam(row: CheckInTeamRow): TournamentCheckInTeam {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    name: row.name,
    tag: row.tag,
    captain: row.captain,
    dept: row.dept,
    checkedInAt: row.checked_in_at,
  }
}

function workspaceWindow(options: WorkspaceListOptions) {
  const limit = options.limit ?? 24
  const offset = options.offset ?? 0
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  ) {
    throw new TypeError('Invalid workspace list window')
  }
  return { limit, offset }
}

function workspacePage<T>(workspaces: readonly T[], total: number, limit: number, offset: number) {
  return {
    workspaces,
    total,
    pagination: {
      offset,
      limit,
      hasPrevious: offset > 0,
      hasNext: offset + workspaces.length < total,
    },
  } satisfies TournamentWorkspacePage<T>
}

export async function getTournamentCheckInDesk(
  tournamentId: number,
): Promise<TournamentCheckInDesk | null> {
  const actor = await requireTournamentStaffCapability(tournamentId, 'tournament.check_in.read')
  const db = cloudflareBindings().db
  const [tournament, teamResult] = await Promise.all([
    db
      .prepare(
        `SELECT id, title, season, edition, status
         FROM tournament
         WHERE id = ?`,
      )
      .bind(tournamentId)
      .first<TournamentRow>(),
    db
      .prepare(
        `SELECT id, tournament_id, name, tag, captain, dept, checked_in_at
         FROM team
         WHERE tournament_id = ?
           AND status = 'approved'
         ORDER BY created_at ASC, id ASC`,
      )
      .bind(tournamentId)
      .all<CheckInTeamRow>(),
  ])

  if (!tournament) return null
  return {
    actor,
    tournament,
    teams: teamResult.results.map(checkInTeam),
  }
}

export async function listCurrentParticipantCheckInWorkspaces(
  options: WorkspaceListOptions = {},
): Promise<TournamentWorkspacePage<ParticipantCheckInWorkspace>> {
  const { limit, offset } = workspaceWindow(options)
  const participant = await getCurrentParticipant()
  if (!participant) return workspacePage([], 0, limit, offset)
  const roles = participantRolesForCapability('tournament.check_in.read')
  const placeholders = roles.map(() => '?').join(', ')
  const db = cloudflareBindings().db
  const now = Date.now()
  const [count, result] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(DISTINCT t.id) AS total
         FROM tournament_role_assignment assignment
         JOIN tournament t ON t.id = assignment.tournament_id
         WHERE assignment.principal_id = ?
           AND assignment.role IN (${placeholders})
           AND assignment.revoked_at IS NULL
           AND (assignment.expires_at IS NULL OR assignment.expires_at > ?)`,
      )
      .bind(participant.principalId, ...roles, now)
      .first<{ total: number }>(),
    db
      .prepare(
        `SELECT DISTINCT t.id, t.title, t.season, t.edition, t.status
       FROM tournament_role_assignment assignment
       JOIN tournament t ON t.id = assignment.tournament_id
       WHERE assignment.principal_id = ?
         AND assignment.role IN (${placeholders})
         AND assignment.revoked_at IS NULL
         AND (assignment.expires_at IS NULL OR assignment.expires_at > ?)
       ORDER BY
         CASE t.status
           WHEN 'running' THEN 0
           WHEN 'registration' THEN 1
           WHEN 'draft' THEN 2
           WHEN 'postponed' THEN 3
           ELSE 4
         END,
         t.id DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(participant.principalId, ...roles, now, limit, offset)
      .all<TournamentRow>(),
  ])
  return workspacePage(result.results, Number(count?.total) || 0, limit, offset)
}

export async function listCurrentUnifiedTournamentWorkspaces(
  options: WorkspaceListOptions = {},
): Promise<TournamentWorkspacePage<UnifiedTournamentWorkspace>> {
  const { limit, offset } = workspaceWindow(options)
  const context = await getAuthContext()
  const now = Date.now()
  if (
    context.kind === 'anonymous' ||
    context.session.recoveryRestricted ||
    context.session.authenticatedAt < now - STAFF_RECENT_AUTH_MAX_AGE_MS
  ) {
    return workspacePage([], 0, limit, offset)
  }
  const roleSet = options.checkInOnly
    ? "('organizer', 'check_in_operator')"
    : "('organizer', 'referee', 'check_in_operator')"
  const db = cloudflareBindings().db
  const [count, result] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(DISTINCT tournament.id) AS total
         FROM identity_role_assignment AS assignment
         JOIN tournament ON tournament.id = assignment.scope_tournament_id
         WHERE assignment.account_id = ? AND assignment.scope_type = 'tournament'
           AND assignment.role IN ${roleSet}
           AND assignment.revoked_at IS NULL AND assignment.granted_at <= ?
           AND (assignment.expires_at IS NULL OR assignment.expires_at > ?)`,
      )
      .bind(context.account.id, now, now)
      .first<{ total: number }>(),
    db
      .prepare(
        `SELECT tournament.id, tournament.slug, tournament.title, tournament.season,
              tournament.edition, tournament.status,
              GROUP_CONCAT(DISTINCT assignment.role) AS roles
       FROM identity_role_assignment AS assignment
       JOIN tournament ON tournament.id = assignment.scope_tournament_id
       WHERE assignment.account_id = ? AND assignment.scope_type = 'tournament'
         AND assignment.role IN ${roleSet}
         AND assignment.revoked_at IS NULL AND assignment.granted_at <= ?
         AND (assignment.expires_at IS NULL OR assignment.expires_at > ?)
       GROUP BY tournament.id
       ORDER BY CASE tournament.status
         WHEN 'running' THEN 0 WHEN 'registration' THEN 1 WHEN 'draft' THEN 2
         WHEN 'postponed' THEN 3 ELSE 4 END, tournament.id DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(context.account.id, now, now, limit, offset)
      .all<TournamentRow & { slug: string; roles: string }>(),
  ])
  const workspaces = result.results.map(row => {
    const roles = row.roles
      .split(',')
      .filter(
        (role): role is UnifiedTournamentWorkspace['roles'][number] =>
          role === 'organizer' || role === 'referee' || role === 'check_in_operator',
      )
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      season: row.season,
      edition: row.edition,
      status: row.status,
      roles,
      canCheckIn: roles.includes('organizer') || roles.includes('check_in_operator'),
    }
  })
  return workspacePage(workspaces, Number(count?.total) || 0, limit, offset)
}

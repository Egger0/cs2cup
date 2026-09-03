import 'server-only'

import { requireTournamentStaffCapability, type TournamentStaffIdentity } from '../auth'
import { participantRolesForCapability } from '../authorization'
import { cloudflareBindings } from '../cloudflare-bindings'
import { getCurrentParticipant } from '../participant-auth'
import type { TournamentStatus } from '../types'

interface TournamentRow {
  id: number
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

export async function listCurrentParticipantCheckInWorkspaces(): Promise<
  ParticipantCheckInWorkspace[]
> {
  const participant = await getCurrentParticipant()
  if (!participant) return []
  const roles = participantRolesForCapability('tournament.check_in.read')
  const placeholders = roles.map(() => '?').join(', ')
  const result = await cloudflareBindings()
    .db.prepare(
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
       LIMIT 24`,
    )
    .bind(participant.principalId, ...roles, Date.now())
    .all<TournamentRow>()
  return result.results
}

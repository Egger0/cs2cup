import 'server-only'
import { requireAdmin, requireTournamentStaffCapability } from '../../auth'
import { cloudflareBindings } from '../../cloudflare-bindings'
import { updatePrivateRows } from '../../rdb'
import type { Team, TeamStatus } from '../../types'

async function adminMutation<Result>(write: () => Promise<Result>) {
  await requireAdmin()
  return write()
}

interface TeamRow {
  id: number
  tournament_id: number
  name: string
  tag: string
  captain: string
  contact: string
  dept: string | null
  note: string | null
  status: TeamStatus
  seed: number | null
  checked_in_at: string | null
  created_at: string
}

interface TeamPlayerRow extends TeamRow {
  player_id: number | null
  player_nickname: string | null
  player_role: string | null
  player_is_substitute: number | null
  player_sort_order: number | null
}

export async function listTeamsWithContact(tournamentId: number): Promise<Team[]> {
  await requireAdmin()

  const rows = (
    await cloudflareBindings()
      .db.prepare(
        `SELECT
          t.id,
          t.tournament_id,
          t.name,
          t.tag,
          t.captain,
          t.contact,
          t.dept,
          t.note,
          t.status,
          t.seed,
          t.checked_in_at,
          t.created_at,
          p.id AS player_id,
          p.nickname AS player_nickname,
          p.role AS player_role,
          p.is_substitute AS player_is_substitute,
          p.sort_order AS player_sort_order
        FROM team t
        LEFT JOIN player p ON p.team_id = t.id
        WHERE t.tournament_id = ?
        ORDER BY t.created_at ASC, t.id ASC, p.sort_order ASC, p.id ASC`,
      )
      .bind(tournamentId)
      .all<TeamPlayerRow>()
  ).results
  const teams = new Map<number, Team>()

  for (const row of rows) {
    let team = teams.get(row.id)
    if (!team) {
      team = {
        id: row.id,
        tournamentId: row.tournament_id,
        name: row.name,
        tag: row.tag,
        captain: row.captain,
        contact: row.contact,
        dept: row.dept,
        note: row.note,
        status: row.status,
        seed: row.seed,
        checkedInAt: row.checked_in_at,
        createdAt: row.created_at,
        players: [],
      }
      teams.set(row.id, team)
    }
    if (row.player_id !== null && row.player_nickname !== null) {
      team.players.push({
        id: row.player_id,
        teamId: row.id,
        nickname: row.player_nickname,
        role: row.player_role,
        isSubstitute: Boolean(row.player_is_substitute),
        sortOrder: row.player_sort_order ?? 0,
      })
    }
  }

  return [...teams.values()]
}

export function setTeamStatus(id: number, tournamentId: number, status: TeamStatus) {
  return adminMutation(() =>
    updatePrivateRows<TeamRow>(
      'team',
      status === 'approved' ? { status } : { status, seed: null, checked_in_at: null },
      { filters: { id: `eq.${id}`, tournament_id: `eq.${tournamentId}` } },
    ),
  )
}

export function setTeamCheckedIn(
  id: number,
  tournamentId: number,
  checkedIn: boolean,
  expectedCheckedInAt: string | null,
) {
  return tournamentCheckInMutation(id, tournamentId, checkedIn, expectedCheckedInAt)
}

async function tournamentCheckInMutation(
  id: number,
  tournamentId: number,
  checkedIn: boolean,
  expectedCheckedInAt: string | null,
) {
  await requireTournamentStaffCapability(tournamentId, 'tournament.check_in.write')
  const nextCheckedInAt = checkedIn ? new Date().toISOString() : null
  const expectedClause =
    expectedCheckedInAt === null ? 'checked_in_at IS NULL' : 'checked_in_at = ?'
  const bindings =
    expectedCheckedInAt === null
      ? [nextCheckedInAt, id, tournamentId]
      : [nextCheckedInAt, id, tournamentId, expectedCheckedInAt]
  return (
    await cloudflareBindings()
      .db.prepare(
        `UPDATE team
         SET checked_in_at = ?
         WHERE id = ?
           AND tournament_id = ?
           AND status = 'approved'
           AND ${expectedClause}
         RETURNING id, tournament_id, checked_in_at`,
      )
      .bind(...bindings)
      .all<Pick<TeamRow, 'id' | 'tournament_id' | 'checked_in_at'>>()
  ).results
}

export function removeTeam(id: number, tournamentId: number) {
  return adminMutation(
    async () =>
      (
        await cloudflareBindings()
          .db.prepare('DELETE FROM team WHERE id = ? AND tournament_id = ? RETURNING id')
          .bind(id, tournamentId)
          .all<{ id: number }>()
      ).results,
  )
}

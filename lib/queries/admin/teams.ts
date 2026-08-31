import 'server-only'
import { requireAdmin } from '../../auth'
import { deletePrivateRows, selectPrivateRows, updatePrivateRows } from '../../rdb'
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
  created_at: string
}

export async function listTeamsWithContact(tournamentId: number): Promise<Team[]> {
  await requireAdmin()

  const [rows, players] = await Promise.all([
    selectPrivateRows<TeamRow>('team', {
      filters: { tournament_id: `eq.${tournamentId}` },
      order: 'created_at.asc',
    }),
    selectPrivateRows<{
      id: number
      team_id: number
      nickname: string
      role: string | null
      is_substitute: boolean
      sort_order: number
    }>('player', { order: 'sort_order.asc' }),
  ])

  return rows.map(row => ({
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
    createdAt: row.created_at,
    players: players
      .filter(player => player.team_id === row.id)
      .map(player => ({
        id: player.id,
        teamId: player.team_id,
        nickname: player.nickname,
        role: player.role,
        isSubstitute: player.is_substitute,
        sortOrder: player.sort_order,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder),
  }))
}

export function setTeamStatus(id: number, status: TeamStatus) {
  return adminMutation(() =>
    updatePrivateRows('team', status === 'approved' ? { status } : { status, seed: null }, {
      filters: { id: `eq.${id}` },
    }),
  )
}

export function removeTeam(id: number) {
  return adminMutation(() => deletePrivateRows('team', { filters: { id: `eq.${id}` } }))
}

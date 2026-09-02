import 'server-only'

import { cloudflareBindings } from '../cloudflare-bindings'
import type { TeamStatus } from '../types'

interface ParticipantEntryRow {
  team_id: number
  team_name: string
  team_tag: string
  captain: string
  contact: string
  dept: string | null
  note: string | null
  team_status: TeamStatus
  registered_at: string
  tournament_id: number
  tournament_slug: string
  tournament_title: string
  player_id: number | null
  player_nickname: string | null
  player_role: string | null
  player_is_substitute: number | null
  player_sort_order: number | null
}

export interface ParticipantTeamMember {
  id: number
  nickname: string
  role: string | null
  isSubstitute: boolean
  sortOrder: number
}

export interface ParticipantTournamentEntry {
  tournament: {
    id: number
    slug: string
    title: string
  }
  team: {
    id: number
    name: string
    tag: string
    captain: string
    contact: string
    dept: string | null
    note: string | null
    status: TeamStatus
    registeredAt: string
    members: ParticipantTeamMember[]
  }
}

export async function listParticipantTournamentEntries(
  principalId: string,
): Promise<ParticipantTournamentEntry[]> {
  const rows = (
    await cloudflareBindings()
      .db.prepare(
        `SELECT
          team.id AS team_id,
          team.name AS team_name,
          team.tag AS team_tag,
          team.captain,
          team.contact,
          team.dept,
          team.note,
          team.status AS team_status,
          team.created_at AS registered_at,
          tournament.id AS tournament_id,
          tournament.slug AS tournament_slug,
          tournament.title AS tournament_title,
          player.id AS player_id,
          player.nickname AS player_nickname,
          player.role AS player_role,
          player.is_substitute AS player_is_substitute,
          player.sort_order AS player_sort_order
        FROM tournament_entry_owner AS owner
        JOIN team ON team.id = owner.team_id
        JOIN tournament ON tournament.id = team.tournament_id
        LEFT JOIN player ON player.team_id = team.id
        WHERE owner.principal_id = ?
        ORDER BY team.created_at DESC, team.id DESC, player.sort_order ASC, player.id ASC`,
      )
      .bind(principalId)
      .all<ParticipantEntryRow>()
  ).results
  const entries = new Map<number, ParticipantTournamentEntry>()

  for (const row of rows) {
    let entry = entries.get(row.team_id)
    if (!entry) {
      entry = {
        tournament: {
          id: row.tournament_id,
          slug: row.tournament_slug,
          title: row.tournament_title,
        },
        team: {
          id: row.team_id,
          name: row.team_name,
          tag: row.team_tag,
          captain: row.captain,
          contact: row.contact,
          dept: row.dept,
          note: row.note,
          status: row.team_status,
          registeredAt: row.registered_at,
          members: [],
        },
      }
      entries.set(row.team_id, entry)
    }

    if (row.player_id !== null && row.player_nickname !== null) {
      entry.team.members.push({
        id: row.player_id,
        nickname: row.player_nickname,
        role: row.player_role,
        isSubstitute: row.player_is_substitute === 1,
        sortOrder: row.player_sort_order ?? 0,
      })
    }
  }

  return [...entries.values()]
}

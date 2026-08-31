import 'server-only'
import { requireAdmin } from '../../auth'
import { selectPrivateRows } from '../../rdb'
import type { Match, MatchMap, VetoAction } from '../../types'

interface MatchRow {
  id: number
  tournament_id: number
  round: number
  slot: number
  round_label: string
  best_of: number
  team_a_id: number | null
  team_b_id: number | null
  source_match_a_id: number | null
  source_match_b_id: number | null
  score_a: number | null
  score_b: number | null
  winner_team_id: number | null
  scheduled_at: string | null
}

interface MatchMapRow {
  id: number
  match_id: number
  pick_order: number
  map_name: string
  action: VetoAction
  chosen_by: 'a' | 'b' | null
  score_a: number | null
  score_b: number | null
  played: boolean
}

export interface MatchMapInput {
  mapName: string
  action: VetoAction
  chosenBy: 'a' | 'b' | null
  scoreA: number | null
  scoreB: number | null
  played: boolean
}

export interface BracketReplaceResult {
  ok: true
  created: number
  byes: number
  teams: number
}

export interface TeamSeedResult {
  ok: true
  tournamentId: number
  teamId: number
  seed: number | null
  swappedTeamId: number | null
}

export interface MatchWriteResult {
  ok: true
  tournamentId: number
  matchId: number
  scoreA: number | null
  scoreB: number | null
  winnerTeamId: number | null
  cleared: number
  reportCleared: boolean
}

export interface MatchReportResult extends MatchWriteResult {
  maps: number
}

export interface MatchScheduleInput {
  id: number
  expectedScheduledAt: string | null
  scheduledAt: string | null
}

export interface MatchScheduleResult {
  ok: true
  matches: number
  scheduled: number
  cleared: number
}

export async function listAdminMatches(tournamentId: number): Promise<Match[]> {
  await requireAdmin()

  const rows = await selectPrivateRows<MatchRow>('match', {
    filters: { tournament_id: `eq.${tournamentId}` },
    order: 'round.asc,slot.asc',
  })

  return rows.map(row => ({
    id: row.id,
    tournamentId: row.tournament_id,
    round: row.round,
    slot: row.slot,
    roundLabel: row.round_label,
    bestOf: row.best_of,
    teamAId: row.team_a_id,
    teamBId: row.team_b_id,
    sourceMatchAId: row.source_match_a_id,
    sourceMatchBId: row.source_match_b_id,
    scoreA: row.score_a,
    scoreB: row.score_b,
    winnerTeamId: row.winner_team_id,
    scheduledAt: row.scheduled_at,
  }))
}

export async function listAdminMatchMaps(matchIds: number[]): Promise<MatchMap[]> {
  await requireAdmin()

  if (matchIds.length === 0) return []

  const ids = [...new Set(matchIds)]
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new TypeError('matchIds must contain positive safe integers')
  }

  const rows = await selectPrivateRows<MatchMapRow>('match_map', {
    filters: { match_id: `in.(${ids.join(',')})` },
    order: 'match_id.asc,pick_order.asc',
  })

  return rows.map(row => ({
    id: row.id,
    matchId: row.match_id,
    pickOrder: row.pick_order,
    mapName: row.map_name,
    action: row.action,
    chosenBy: row.chosen_by,
    scoreA: row.score_a,
    scoreB: row.score_b,
    played: row.played,
  }))
}

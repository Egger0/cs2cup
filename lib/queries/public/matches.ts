import 'server-only'
import { selectPublicRows } from '../../rdb'
import type { Match, MatchMap, Photo, Player, PublicTeam, VetoAction } from '../../types'

const TEAM_SELECT = 'id,tournament_id,name,tag,captain,dept,seed'
const PLAYER_SELECT = 'id,team_id,tournament_id,nickname,role,is_substitute,sort_order'
const MATCH_SELECT =
  'id,tournament_id,round,slot,round_label,best_of,team_a_id,team_b_id,' +
  'source_match_a_id,source_match_b_id,score_a,score_b,winner_team_id,scheduled_at'
const PHOTO_SELECT = 'id,tournament_id,storage_key,width,height,blur_data_url,caption,sort_order'
const MATCH_MAP_SELECT = 'id,match_id,pick_order,map_name,action,chosen_by,score_a,score_b,played'

interface TeamRow {
  id: number
  tournament_id: number
  name: string
  tag: string
  captain: string
  dept: string | null
  seed: number | null
}

interface PlayerRow {
  id: number
  team_id: number
  nickname: string
  role: string | null
  is_substitute: boolean
  sort_order: number
}

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

interface PhotoRow {
  id: number
  tournament_id: number
  storage_key: string
  width: number
  height: number
  blur_data_url: string | null
  caption: string | null
  sort_order: number
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

function toPlayer(row: PlayerRow): Player {
  return {
    id: row.id,
    teamId: row.team_id,
    nickname: row.nickname,
    role: row.role,
    isSubstitute: row.is_substitute,
    sortOrder: row.sort_order,
  }
}

function toMatch(row: MatchRow): Match {
  return {
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
  }
}

export async function getPublicTeams(tournamentId: number): Promise<PublicTeam[]> {
  const [teams, players] = await Promise.all([
    selectPublicRows<TeamRow>('team_public', {
      select: TEAM_SELECT,
      filters: { tournament_id: `eq.${tournamentId}` },
      order: 'seed.asc.nullslast',
    }),
    selectPublicRows<PlayerRow>('player_public', {
      select: PLAYER_SELECT,
      filters: { tournament_id: `eq.${tournamentId}` },
      order: 'sort_order.asc',
    }),
  ])

  const byTeam = new Map<number, Player[]>()
  for (const row of players) {
    const player = toPlayer(row)
    const list = byTeam.get(row.team_id)
    if (list) list.push(player)
    else byTeam.set(row.team_id, [player])
  }

  return teams.map(row => ({
    id: row.id,
    tournamentId: row.tournament_id,
    name: row.name,
    tag: row.tag,
    captain: row.captain,
    dept: row.dept,
    seed: row.seed,
    players: byTeam.get(row.id) ?? [],
  }))
}

export async function getMatches(tournamentId: number): Promise<Match[]> {
  const rows = await selectPublicRows<MatchRow>('match_public', {
    select: MATCH_SELECT,
    filters: { tournament_id: `eq.${tournamentId}` },
    order: 'round.asc,slot.asc',
  })
  return rows.map(toMatch)
}

export async function getPhotos(tournamentId?: number): Promise<Photo[]> {
  const rows = await selectPublicRows<PhotoRow>('photo_public', {
    select: PHOTO_SELECT,
    filters: tournamentId ? { tournament_id: `eq.${tournamentId}` } : undefined,
    order: 'sort_order.asc',
  })
  return rows.map(row => ({
    id: row.id,
    tournamentId: row.tournament_id,
    storageKey: row.storage_key,
    width: row.width,
    height: row.height,
    blurDataUrl: row.blur_data_url,
    caption: row.caption,
    sortOrder: row.sort_order,
  }))
}

export async function getMatchMaps(matchIds: number[]): Promise<MatchMap[]> {
  if (matchIds.length === 0) return []
  const rows = await selectPublicRows<MatchMapRow>('match_map_public', {
    select: MATCH_MAP_SELECT,
    filters: { match_id: `in.(${matchIds.join(',')})` },
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

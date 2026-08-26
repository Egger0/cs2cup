import 'server-only'
import { deleteRows, insertRows, selectRows, updateRows } from '../rdb'
import type { Match, Photo, Team, TeamStatus, Tournament } from '../types'

const ADMIN = { credential: 'admin', revalidate: false } as const

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
  player: {
    id: number
    team_id: number
    nickname: string
    is_substitute: boolean
    sort_order: number
  }[]
}

export async function listTeamsWithContact(tournamentId: number): Promise<Team[]> {
  const rows = await selectRows<TeamRow>('team', {
    ...ADMIN,
    select: '*,player(*)',
    filters: { tournament_id: `eq.${tournamentId}` },
    order: 'created_at.asc',
  })

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
    players: (row.player ?? [])
      .map(p => ({
        id: p.id,
        teamId: p.team_id,
        nickname: p.nickname,
        isSubstitute: p.is_substitute,
        sortOrder: p.sort_order,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder),
  }))
}

export function setTeamStatus(id: number, status: TeamStatus) {
  return updateRows('team', { status }, { ...ADMIN, filters: { id: `eq.${id}` } })
}

export function setTeamSeed(id: number, seed: number | null) {
  return updateRows('team', { seed }, { ...ADMIN, filters: { id: `eq.${id}` } })
}

export function removeTeam(id: number) {
  return deleteRows('team', { ...ADMIN, filters: { id: `eq.${id}` } })
}

export function saveTournament(id: number, values: Partial<Tournament>) {
  const payload: Record<string, unknown> = {}
  if (values.title !== undefined) payload.title = values.title
  if (values.status !== undefined) payload.status = values.status
  if (values.teamCap !== undefined) payload.team_cap = values.teamCap
  if (values.regDeadline !== undefined) payload.reg_deadline = values.regDeadline
  if (values.startsAt !== undefined) payload.starts_at = values.startsAt
  if (values.accentColor !== undefined) payload.accent_color = values.accentColor
  if (values.mapPool !== undefined) payload.map_pool = values.mapPool
  if (values.rules !== undefined) payload.rules = values.rules
  if (values.faqs !== undefined) payload.faqs = values.faqs
  if (values.heroEyebrow !== undefined) payload.hero_eyebrow = values.heroEyebrow
  if (values.heroTop !== undefined) payload.hero_top = values.heroTop
  if (values.heroBottom !== undefined) payload.hero_bottom = values.heroBottom
  if (values.lede !== undefined) payload.lede = values.lede

  return updateRows('tournament', payload, { ...ADMIN, filters: { id: `eq.${id}` } })
}

export function saveMatchScore(
  id: number,
  scoreA: number | null,
  scoreB: number | null,
  winnerTeamId: number | null,
) {
  return updateRows(
    'match',
    { score_a: scoreA, score_b: scoreB, winner_team_id: winnerTeamId },
    { ...ADMIN, filters: { id: `eq.${id}` } },
  )
}

export function clearMatches(ids: number[]) {
  if (ids.length === 0) return Promise.resolve([])
  return updateRows(
    'match',
    { score_a: null, score_b: null, winner_team_id: null },
    { ...ADMIN, filters: { id: `in.(${ids.join(',')})` } },
  )
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

export async function listAdminMatches(tournamentId: number): Promise<Match[]> {
  const rows = await selectRows<MatchRow>('match', {
    ...ADMIN,
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

export function addPhoto(values: Omit<Photo, 'id'>) {
  return insertRows('photo', {
    tournament_id: values.tournamentId,
    storage_key: values.storageKey,
    width: values.width,
    height: values.height,
    blur_data_url: values.blurDataUrl,
    caption: values.caption,
    sort_order: values.sortOrder,
  }, ADMIN)
}

export function removePhoto(id: number) {
  return deleteRows('photo', { ...ADMIN, filters: { id: `eq.${id}` } })
}

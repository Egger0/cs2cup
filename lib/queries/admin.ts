import 'server-only'
import { requireAdmin } from '../auth'
import { callFunction, deleteRows, insertRows, selectRows, updateRows } from '../rdb'
import type { Match, MatchMap, Photo, Team, TeamStatus, Tournament, VetoAction } from '../types'

const ADMIN = { credential: 'admin', revalidate: false } as const

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
  player: {
    id: number
    team_id: number
    nickname: string
    role: string | null
    is_substitute: boolean
    sort_order: number
  }[]
}

export async function listTeamsWithContact(tournamentId: number): Promise<Team[]> {
  await requireAdmin()

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
        role: p.role,
        isSubstitute: p.is_substitute,
        sortOrder: p.sort_order,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder),
  }))
}

export function setTeamStatus(id: number, status: TeamStatus) {
  return adminMutation(() =>
    updateRows(
      'team',
      status === 'approved' ? { status } : { status, seed: null },
      { ...ADMIN, filters: { id: `eq.${id}` } },
    ),
  )
}

export function removeTeam(id: number) {
  return adminMutation(() =>
    deleteRows('team', { ...ADMIN, filters: { id: `eq.${id}` } }),
  )
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

  return adminMutation(() =>
    updateRows('tournament', payload, { ...ADMIN, filters: { id: `eq.${id}` } }),
  )
}

export function saveMatchScore(
  id: number,
  scoreA: number | null,
  scoreB: number | null,
  winnerTeamId: number | null,
) {
  return adminMutation(() =>
    updateRows(
      'match',
      { score_a: scoreA, score_b: scoreB, winner_team_id: winnerTeamId },
      { ...ADMIN, filters: { id: `eq.${id}` } },
    ),
  )
}

export function clearMatches(ids: number[]) {
  return adminMutation(() => {
    if (ids.length === 0) return Promise.resolve([])
    return updateRows(
      'match',
      { score_a: null, score_b: null, winner_team_id: null },
      { ...ADMIN, filters: { id: `in.(${ids.join(',')})` } },
    )
  })
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
  await requireAdmin()

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

export async function listAdminMatchMaps(matchIds: number[]): Promise<MatchMap[]> {
  await requireAdmin()

  if (matchIds.length === 0) return []

  const ids = [...new Set(matchIds)]
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new TypeError('matchIds must contain positive safe integers')
  }

  const rows = await selectRows<MatchMapRow>('match_map', {
    ...ADMIN,
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

export function replaceBracket(
  tournamentId: number,
  teamIds: number[],
  seedPositions: number[],
): Promise<BracketReplaceResult> {
  return adminMutation(() =>
    callFunction<BracketReplaceResult>(
      'replace_bracket',
      {
        p_tournament_id: tournamentId,
        p_team_ids: teamIds,
        p_seed_positions: seedPositions,
      },
      'admin',
    ),
  )
}

export function assignTeamSeed(
  tournamentId: number,
  teamId: number,
  seed: number | null,
): Promise<TeamSeedResult> {
  return adminMutation(() =>
    callFunction<TeamSeedResult>(
      'set_team_seed',
      { p_tournament_id: tournamentId, p_team_id: teamId, p_seed: seed },
      'admin',
    ),
  )
}

export function saveAdminMatchScore(
  matchId: number,
  teamAId: number | null,
  teamBId: number | null,
  scoreA: number | null,
  scoreB: number | null,
): Promise<MatchWriteResult> {
  return adminMutation(() =>
    callFunction<MatchWriteResult>(
      'save_match_score',
      {
        p_match_id: matchId,
        p_team_a_id: teamAId,
        p_team_b_id: teamBId,
        p_score_a: scoreA,
        p_score_b: scoreB,
      },
      'admin',
    ),
  )
}

export function saveAdminMatchReport(
  matchId: number,
  teamAId: number,
  teamBId: number,
  maps: MatchMapInput[],
): Promise<MatchReportResult> {
  return adminMutation(() =>
    callFunction<MatchReportResult>(
      'save_match_report',
      {
        p_match_id: matchId,
        p_team_a_id: teamAId,
        p_team_b_id: teamBId,
        p_maps: maps,
      },
      'admin',
    ),
  )
}

export function replaceMatchSchedule(
  tournamentId: number,
  matches: MatchScheduleInput[],
): Promise<MatchScheduleResult> {
  return adminMutation(() =>
    callFunction<MatchScheduleResult>(
      'replace_match_schedule',
      {
        p_tournament_id: tournamentId,
        p_match_ids: matches.map(match => match.id),
        p_expected_scheduled_at: matches.map(match => match.expectedScheduledAt),
        p_scheduled_at: matches.map(match => match.scheduledAt),
      },
      'admin',
    ),
  )
}

export function addPhoto(values: Omit<Photo, 'id'>) {
  return adminMutation(() =>
    insertRows(
      'photo',
      {
        tournament_id: values.tournamentId,
        storage_key: values.storageKey,
        width: values.width,
        height: values.height,
        blur_data_url: values.blurDataUrl,
        caption: values.caption,
        sort_order: values.sortOrder,
      },
      ADMIN,
    ),
  )
}

export function removePhoto(id: number) {
  return adminMutation(() =>
    deleteRows('photo', { ...ADMIN, filters: { id: `eq.${id}` } }),
  )
}

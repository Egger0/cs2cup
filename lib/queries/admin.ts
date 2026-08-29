import 'server-only'

import { requireAdmin } from '../auth'
import {
  DatabaseError,
  database,
  databaseOperation,
  isoDatabaseTimestamp,
  nullableIsoDatabaseTimestamp,
  safeDatabaseInteger,
} from '../database'
import type { DatabaseClient } from '../database'
import type { Match, MatchMap, Team, TeamStatus, VetoAction } from '../types'

async function adminMutation<Result>(operation: string, write: () => Promise<Result>) {
  await requireAdmin()
  return databaseOperation(operation, write)
}

interface TeamPlayerRow {
  team_id: unknown
  tournament_id: unknown
  name: string
  tag: string
  captain: string
  contact: string
  dept: string | null
  note: string | null
  status: TeamStatus
  seed: unknown | null
  created_at: unknown
  player_id: unknown | null
  player_team_id: unknown | null
  player_nickname: string | null
  player_role: string | null
  player_is_substitute: boolean | null
  player_sort_order: unknown | null
}

export async function listTeamsWithContact(tournamentId: number): Promise<Team[]> {
  await requireAdmin()

  return databaseOperation('admin:list-teams-with-contact', async () => {
    const sql = database()
    const rows = await sql<TeamPlayerRow[]>`
      select
        team.id as team_id,
        team.tournament_id,
        team.name,
        team.tag,
        team.captain,
        team.contact,
        team.dept,
        team.note,
        team.status,
        team.seed,
        team.created_at,
        player.id as player_id,
        player.team_id as player_team_id,
        player.nickname as player_nickname,
        player.role as player_role,
        player.is_substitute as player_is_substitute,
        player.sort_order as player_sort_order
      from public.team team
      left join public.player player on player.team_id = team.id
      where team.tournament_id = ${tournamentId}::bigint
      order by team.created_at asc, player.sort_order asc, player.id asc
    `

    const teams = new Map<number, Team>()
    for (const row of rows) {
      const teamId = safeDatabaseInteger(row.team_id, 'team.id')
      let team = teams.get(teamId)
      if (!team) {
        team = {
          id: teamId,
          tournamentId: safeDatabaseInteger(row.tournament_id, 'team.tournament_id'),
          name: row.name,
          tag: row.tag,
          captain: row.captain,
          contact: row.contact,
          dept: row.dept,
          note: row.note,
          status: row.status,
          seed: row.seed === null ? null : safeDatabaseInteger(row.seed, 'team.seed'),
          createdAt: isoDatabaseTimestamp(row.created_at, 'team.created_at'),
          players: [],
        }
        teams.set(teamId, team)
      }

      if (row.player_id !== null) {
        if (
          row.player_team_id === null ||
          row.player_nickname === null ||
          row.player_is_substitute === null ||
          row.player_sort_order === null
        ) {
          throw new DatabaseError('decode:team.player', null, false)
        }
        team.players.push({
          id: safeDatabaseInteger(row.player_id, 'player.id'),
          teamId: safeDatabaseInteger(row.player_team_id, 'player.team_id'),
          nickname: row.player_nickname,
          role: row.player_role,
          isSubstitute: row.player_is_substitute,
          sortOrder: safeDatabaseInteger(row.player_sort_order, 'player.sort_order'),
        })
      }
    }
    return [...teams.values()]
  })
}

export function setTeamStatus(id: number, status: TeamStatus) {
  return adminMutation('admin:set-team-status', async () => {
    const sql = database()
    await sql`
      update public.team
      set
        status = ${status},
        seed = case when ${status} = 'approved' then seed else null end
      where id = ${id}::bigint
    `
  })
}

export function removeTeam(id: number) {
  return adminMutation('admin:remove-team', async () => {
    const sql = database()
    await sql`delete from public.team where id = ${id}::bigint`
  })
}

interface MatchRow {
  id: unknown
  tournament_id: unknown
  round: unknown
  slot: unknown
  round_label: string
  best_of: unknown
  team_a_id: unknown | null
  team_b_id: unknown | null
  source_match_a_id: unknown | null
  source_match_b_id: unknown | null
  score_a: unknown | null
  score_b: unknown | null
  winner_team_id: unknown | null
  scheduled_at: unknown | null
}

function toMatch(row: MatchRow): Match {
  return {
    id: safeDatabaseInteger(row.id, 'match.id'),
    tournamentId: safeDatabaseInteger(row.tournament_id, 'match.tournament_id'),
    round: safeDatabaseInteger(row.round, 'match.round'),
    slot: safeDatabaseInteger(row.slot, 'match.slot'),
    roundLabel: row.round_label,
    bestOf: safeDatabaseInteger(row.best_of, 'match.best_of'),
    teamAId: row.team_a_id === null ? null : safeDatabaseInteger(row.team_a_id, 'match.team_a_id'),
    teamBId: row.team_b_id === null ? null : safeDatabaseInteger(row.team_b_id, 'match.team_b_id'),
    sourceMatchAId: row.source_match_a_id === null
      ? null
      : safeDatabaseInteger(row.source_match_a_id, 'match.source_match_a_id'),
    sourceMatchBId: row.source_match_b_id === null
      ? null
      : safeDatabaseInteger(row.source_match_b_id, 'match.source_match_b_id'),
    scoreA: row.score_a === null ? null : safeDatabaseInteger(row.score_a, 'match.score_a'),
    scoreB: row.score_b === null ? null : safeDatabaseInteger(row.score_b, 'match.score_b'),
    winnerTeamId: row.winner_team_id === null
      ? null
      : safeDatabaseInteger(row.winner_team_id, 'match.winner_team_id'),
    scheduledAt: nullableIsoDatabaseTimestamp(row.scheduled_at, 'match.scheduled_at'),
  }
}

export async function listAdminMatches(tournamentId: number): Promise<Match[]> {
  await requireAdmin()

  return databaseOperation('admin:list-matches', async () => {
    const sql = database()
    const rows = await sql<MatchRow[]>`
      select
        id,
        tournament_id,
        round,
        slot,
        round_label,
        best_of,
        team_a_id,
        team_b_id,
        source_match_a_id,
        source_match_b_id,
        score_a,
        score_b,
        winner_team_id,
        scheduled_at
      from public.match
      where tournament_id = ${tournamentId}::bigint
      order by round asc, slot asc
    `
    return rows.map(toMatch)
  })
}

interface MatchMapRow {
  id: unknown
  match_id: unknown
  pick_order: unknown
  map_name: string
  action: VetoAction
  chosen_by: 'a' | 'b' | null
  score_a: unknown | null
  score_b: unknown | null
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

function bigintArray(sql: DatabaseClient, values: number[]) {
  return sql`
    array(
      select element.value::bigint
      from jsonb_array_elements_text(${sql.json(values)})
        with ordinality as element(value, position)
      order by element.position
    )
  `
}

function integerArray(sql: DatabaseClient, values: number[]) {
  return sql`
    array(
      select element.value::integer
      from jsonb_array_elements_text(${sql.json(values)})
        with ordinality as element(value, position)
      order by element.position
    )
  `
}

function timestampArray(sql: DatabaseClient, values: (string | null)[]) {
  return sql`
    array(
      select element.value::timestamptz
      from jsonb_array_elements_text(${sql.json(values)})
        with ordinality as element(value, position)
      order by element.position
    )
  `
}

export async function listAdminMatchMaps(matchIds: number[]): Promise<MatchMap[]> {
  await requireAdmin()

  if (matchIds.length === 0) return []

  const ids = [...new Set(matchIds)]
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new TypeError('matchIds must contain positive safe integers')
  }

  return databaseOperation('admin:list-match-maps', async () => {
    const sql = database()
    const rows = await sql<MatchMapRow[]>`
      select id, match_id, pick_order, map_name, action, chosen_by,
        score_a, score_b, played
      from public.match_map
      where match_id in ${sql(ids)}
      order by match_id asc, pick_order asc
    `

    return rows.map(row => ({
      id: safeDatabaseInteger(row.id, 'match_map.id'),
      matchId: safeDatabaseInteger(row.match_id, 'match_map.match_id'),
      pickOrder: safeDatabaseInteger(row.pick_order, 'match_map.pick_order'),
      mapName: row.map_name,
      action: row.action,
      chosenBy: row.chosen_by,
      scoreA: row.score_a === null ? null : safeDatabaseInteger(row.score_a, 'match_map.score_a'),
      scoreB: row.score_b === null ? null : safeDatabaseInteger(row.score_b, 'match_map.score_b'),
      played: row.played,
    }))
  })
}

function rpcResult<Result>(rows: { result: Result }[], operation: string) {
  const result = rows[0]?.result
  if (result === undefined || result === null) {
    throw new DatabaseError(`decode:${operation}`, null, false)
  }
  return result
}

export function replaceBracket(
  tournamentId: number,
  teamIds: number[],
  seedPositions: number[],
): Promise<BracketReplaceResult> {
  return adminMutation('admin:replace-bracket', async () => {
    const sql = database()
    const rows = await sql<{ result: BracketReplaceResult }[]>`
      select public.replace_bracket(
        ${tournamentId}::bigint,
        ${bigintArray(sql, teamIds)},
        ${integerArray(sql, seedPositions)}
      ) as result
    `
    return rpcResult(rows, 'replace-bracket')
  })
}

export function assignTeamSeed(
  tournamentId: number,
  teamId: number,
  seed: number | null,
): Promise<TeamSeedResult> {
  return adminMutation('admin:set-team-seed', async () => {
    const sql = database()
    const rows = await sql<{ result: TeamSeedResult }[]>`
      select public.set_team_seed(
        ${tournamentId}::bigint,
        ${teamId}::bigint,
        ${seed}::integer
      ) as result
    `
    return rpcResult(rows, 'set-team-seed')
  })
}

export function saveAdminMatchScore(
  matchId: number,
  teamAId: number | null,
  teamBId: number | null,
  scoreA: number | null,
  scoreB: number | null,
): Promise<MatchWriteResult> {
  return adminMutation('admin:save-match-score', async () => {
    const sql = database()
    const rows = await sql<{ result: MatchWriteResult }[]>`
      select public.save_match_score(
        ${matchId}::bigint,
        ${teamAId}::bigint,
        ${teamBId}::bigint,
        ${scoreA}::integer,
        ${scoreB}::integer
      ) as result
    `
    return rpcResult(rows, 'save-match-score')
  })
}

export function saveAdminMatchReport(
  matchId: number,
  teamAId: number,
  teamBId: number,
  maps: MatchMapInput[],
): Promise<MatchReportResult> {
  return adminMutation('admin:save-match-report', async () => {
    const sql = database()
    const payload = maps.map(map => ({
      mapName: map.mapName,
      action: map.action,
      chosenBy: map.chosenBy,
      scoreA: map.scoreA,
      scoreB: map.scoreB,
      played: map.played,
    }))
    const rows = await sql<{ result: MatchReportResult }[]>`
      select public.save_match_report(
        ${matchId}::bigint,
        ${teamAId}::bigint,
        ${teamBId}::bigint,
        ${sql.json(payload)}::jsonb
      ) as result
    `
    return rpcResult(rows, 'save-match-report')
  })
}

export function replaceMatchSchedule(
  tournamentId: number,
  matches: MatchScheduleInput[],
): Promise<MatchScheduleResult> {
  return adminMutation('admin:replace-match-schedule', async () => {
    const sql = database()
    const rows = await sql<{ result: MatchScheduleResult }[]>`
      select public.replace_match_schedule(
        ${tournamentId}::bigint,
        ${bigintArray(sql, matches.map(match => match.id))},
        ${timestampArray(sql, matches.map(match => match.expectedScheduledAt))},
        ${timestampArray(sql, matches.map(match => match.scheduledAt))}
      ) as result
    `
    return rpcResult(rows, 'replace-match-schedule')
  })
}

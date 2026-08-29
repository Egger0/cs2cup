import 'server-only'
import { requireAdmin } from '../auth'
import { cloudflareBindings, type CloudflareD1Statement } from '../cloudflare-bindings'
import {
  deletePrivateRows,
  selectPrivateRows,
  updatePrivateRows,
} from '../rdb'
import type { Match, MatchMap, Team, TeamStatus, VetoAction } from '../types'

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
    selectPrivateRows<{ id: number; team_id: number; nickname: string; role: string | null; is_substitute: boolean; sort_order: number }>('player', { order: 'sort_order.asc' }),
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
    players: players.filter(player => player.team_id === row.id)
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
    updatePrivateRows(
      'team',
      status === 'approved' ? { status } : { status, seed: null },
      { filters: { id: `eq.${id}` } },
    ),
  )
}

export function removeTeam(id: number) {
  return adminMutation(() =>
    deletePrivateRows('team', { filters: { id: `eq.${id}` } }),
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

export async function replaceBracket(
  tournamentId: number,
  teamIds: number[],
  seedPositions: number[],
): Promise<BracketReplaceResult> {
  await requireAdmin()
  const { db } = cloudflareBindings()
  const approved = await db.prepare("SELECT id FROM team WHERE tournament_id = ? AND status = 'approved' ORDER BY id").bind(tournamentId).all<{ id: number }>()
  const input = [...teamIds].sort((a, b) => a - b)
  if (teamIds.length < 2 || input.length !== approved.results.length || input.some((id, index) => id !== approved.results[index]?.id)) throw new Error('传入战队必须与全部已通过审核的战队一致')
  const size = seedPositions.length
  if (size < teamIds.length || (size & (size - 1)) !== 0 || new Set(seedPositions).size !== size || Math.min(...seedPositions) !== 1 || Math.max(...seedPositions) !== size) throw new Error('签位排列无效')
  const firstPairs = Array.from({ length: size / 2 }, (_, slot) => ({ a: seedPositions[slot * 2]! <= teamIds.length ? teamIds[seedPositions[slot * 2]! - 1] ?? null : null, b: seedPositions[slot * 2 + 1]! <= teamIds.length ? teamIds[seedPositions[slot * 2 + 1]! - 1] ?? null : null }))
  if (firstPairs.some(pair => pair.a === null && pair.b === null)) throw new Error('签位排列产生了空白首轮')
  const replacement = [
    db.prepare('DELETE FROM match WHERE tournament_id = ?').bind(tournamentId),
    db.prepare('UPDATE team SET seed = NULL WHERE tournament_id = ?').bind(tournamentId),
    ...teamIds.map((id, index) => db.prepare('UPDATE team SET seed = ? WHERE id = ?').bind(index + 1, id)),
    db.prepare('UPDATE tournament SET champion_name = NULL WHERE id = ?').bind(tournamentId),
  ]
  const inserts = []
  let count = size / 2; let round = 0
  while (count >= 1) {
    const label = count === 1 ? '总决赛' : count === 2 ? '半决赛' : count === 4 ? '八强' : count === 8 ? '16 强' : `第 ${round + 1} 轮`
    for (let slot = 0; slot < count; slot += 1) {
      inserts.push(db.prepare('INSERT INTO match (tournament_id,round,slot,round_label,best_of,team_a_id,team_b_id,winner_team_id) VALUES (?,?,?,?,?,?,?,?)').bind(
        tournamentId, round, slot, label, count === 1 ? 5 : 3,
        round === 0 ? firstPairs[slot]?.a ?? null : null,
        round === 0 ? firstPairs[slot]?.b ?? null : null,
        round === 0 && ((firstPairs[slot]?.a === null) !== (firstPairs[slot]?.b === null))
          ? firstPairs[slot]?.a ?? firstPairs[slot]?.b ?? null
          : null,
      ))
    }
    count /= 2; round += 1
  }
  await db.batch([
    ...replacement,
    ...inserts,
    db.prepare(`
      UPDATE match AS target
      SET source_match_a_id = (
            SELECT source.id FROM match AS source
            WHERE source.tournament_id = target.tournament_id
              AND source.round = target.round - 1 AND source.slot = target.slot * 2
          ),
          source_match_b_id = (
            SELECT source.id FROM match AS source
            WHERE source.tournament_id = target.tournament_id
              AND source.round = target.round - 1 AND source.slot = target.slot * 2 + 1
          )
      WHERE target.tournament_id = ? AND target.round > 0
    `).bind(tournamentId),
  ])
  return { ok: true, created: inserts.length, byes: firstPairs.filter(pair => (pair.a === null) !== (pair.b === null)).length, teams: teamIds.length }
}

export async function assignTeamSeed(
  tournamentId: number,
  teamId: number,
  seed: number | null,
): Promise<TeamSeedResult> {
  await requireAdmin()
  const { db } = cloudflareBindings()
  const team = await db.prepare('SELECT status, seed FROM team WHERE id = ? AND tournament_id = ?').bind(teamId, tournamentId).first<{ status: TeamStatus; seed: number | null }>()
  if (!team) throw new Error('战队不存在')
  if (seed === null) {
    await db.prepare('UPDATE team SET seed = NULL WHERE id = ?').bind(teamId).run()
    return { ok: true, tournamentId, teamId, seed: null, swappedTeamId: null }
  }
  const approved = await db.prepare("SELECT COUNT(*) AS count FROM team WHERE tournament_id = ? AND status = 'approved'").bind(tournamentId).first<{ count: number }>()
  if (team.status !== 'approved' || seed < 1 || seed > (approved?.count ?? 0)) throw new Error('种子号无效')
  const conflict = await db.prepare("SELECT id FROM team WHERE tournament_id = ? AND status = 'approved' AND id != ? AND seed = ?").bind(tournamentId, teamId, seed).first<{ id: number }>()
  await db.batch([
    ...(conflict ? [db.prepare('UPDATE team SET seed = ? WHERE id = ?').bind(team.seed, conflict.id)] : []),
    db.prepare('UPDATE team SET seed = ? WHERE id = ?').bind(seed, teamId),
  ])
  return { ok: true, tournamentId, teamId, seed, swappedTeamId: conflict?.id ?? null }
}

async function prepareAdminMatchScore(
  matchId: number,
  teamAId: number | null,
  teamBId: number | null,
  scoreA: number | null,
  scoreB: number | null,
): Promise<{ db: ReturnType<typeof cloudflareBindings>['db']; result: MatchWriteResult; statements: CloudflareD1Statement[] }> {
  const { db } = cloudflareBindings()
  const match = await db.prepare('SELECT m.*, COALESCE(m.team_a_id, a.winner_team_id) AS resolved_a, COALESCE(m.team_b_id, b.winner_team_id) AS resolved_b FROM match m LEFT JOIN match a ON a.id = m.source_match_a_id LEFT JOIN match b ON b.id = m.source_match_b_id WHERE m.id = ?').bind(matchId).first<{ tournament_id: number; round: number; best_of: number; team_a_id: number | null; team_b_id: number | null; source_match_a_id: number | null; source_match_b_id: number | null; winner_team_id: number | null; resolved_a: number | null; resolved_b: number | null }>()
  if (!match || match.resolved_a !== teamAId || match.resolved_b !== teamBId) throw new Error('对阵双方已变化，请刷新后重试')
  if ((scoreA === null) !== (scoreB === null)) throw new Error('双方比分必须同时填写或同时清空')
  const wins = Math.floor(match.best_of / 2) + 1
  if (scoreA !== null && (scoreA < 0 || scoreB! < 0 || scoreA > wins || scoreB! > wins || (scoreA === wins && scoreB === wins))) throw new Error('比分无效')
  const winner = scoreA === null ? (match.round === 0 && ((match.team_a_id === null) !== (match.team_b_id === null)) ? (match.team_a_id ?? match.team_b_id) : null) : scoreA === wins && scoreA > scoreB! ? teamAId : scoreB === wins && scoreB > scoreA ? teamBId : null
  const all = await db.prepare('SELECT id, round, slot, source_match_a_id, source_match_b_id FROM match WHERE tournament_id = ?').bind(match.tournament_id).all<{ id: number; round: number; slot: number; source_match_a_id: number | null; source_match_b_id: number | null }>()
  const descendants = new Set<number>(); const queue = [matchId]
  while (queue.length) { const parent = queue.shift(); for (const child of all.results.filter(entry => entry.source_match_a_id === parent || entry.source_match_b_id === parent)) if (!descendants.has(child.id)) { descendants.add(child.id); queue.push(child.id) } }
  const changed = match.winner_team_id !== winner
  const final = [...all.results].sort((left, right) => right.round - left.round || left.slot - right.slot)[0]
  const statements = [
    db.prepare('UPDATE match SET score_a = ?, score_b = ?, winner_team_id = ? WHERE id = ?').bind(scoreA, scoreB, winner, matchId),
    ...(changed ? [...descendants].flatMap(id => [db.prepare('DELETE FROM match_map WHERE match_id = ?').bind(id), db.prepare('UPDATE match SET score_a = NULL, score_b = NULL, winner_team_id = NULL WHERE id = ?').bind(id)]) : []),
    ...(final && (final.id === matchId || descendants.has(final.id)) ? [
      db.prepare('UPDATE tournament SET champion_name = (SELECT team.name FROM match LEFT JOIN team ON team.id = match.winner_team_id WHERE match.id = ?) WHERE id = ?').bind(final.id, match.tournament_id),
    ] : []),
  ]
  return {
    db,
    statements,
    result: { ok: true, tournamentId: match.tournament_id, matchId, scoreA, scoreB, winnerTeamId: winner, cleared: changed ? descendants.size : 0 },
  }
}

export async function saveAdminMatchScore(
  matchId: number,
  teamAId: number | null,
  teamBId: number | null,
  scoreA: number | null,
  scoreB: number | null,
): Promise<MatchWriteResult> {
  await requireAdmin()
  const change = await prepareAdminMatchScore(matchId, teamAId, teamBId, scoreA, scoreB)
  await change.db.batch(change.statements)
  return change.result
}

export async function saveAdminMatchReport(
  matchId: number,
  teamAId: number,
  teamBId: number,
  maps: MatchMapInput[],
): Promise<MatchReportResult> {
  await requireAdmin()
  const { db } = cloudflareBindings()
  const match = await db.prepare('SELECT m.best_of, t.map_pool FROM match m JOIN tournament t ON t.id = m.tournament_id WHERE m.id = ?').bind(matchId).first<{ best_of: number; map_pool: string }>()
  if (!match) throw new Error('比赛不存在')
  const pool = JSON.parse(match.map_pool) as string[]
  if (!Array.isArray(maps) || maps.length === 0 || maps.length > pool.length) throw new Error('地图战报无效')
  const used = new Set<string>(); let winsA = 0; let winsB = 0
  const winsRequired = Math.floor(match.best_of / 2) + 1
  let seriesDecided = false
  for (const map of maps) {
    if (
      typeof map.mapName !== 'string'
      || !pool.includes(map.mapName)
      || used.has(map.mapName.toLowerCase())
      || !['ban', 'pick', 'decider'].includes(map.action)
      || typeof map.played !== 'boolean'
      || (map.action === 'decider' ? map.chosenBy !== null : !['a', 'b'].includes(map.chosenBy ?? ''))
    ) throw new Error('地图战报无效')
    used.add(map.mapName.toLowerCase())
    if (map.action === 'ban' && (map.played || map.scoreA !== null || map.scoreB !== null)) throw new Error('被禁用的地图不能填写比分')
    if (!map.played && (map.scoreA !== null || map.scoreB !== null)) throw new Error('未进行地图不能填写比分')
    if (map.played) {
      const scoreA = map.scoreA
      const scoreB = map.scoreB
      if (
        seriesDecided
        || map.action === 'ban'
        || scoreA === null
        || scoreB === null
        || !Number.isSafeInteger(scoreA)
        || !Number.isSafeInteger(scoreB)
        || scoreA < 0
        || scoreB < 0
        || scoreA === scoreB
      ) throw new Error('已进行地图的比分无效')
      if (scoreA > scoreB) winsA += 1; else winsB += 1
      seriesDecided = winsA === winsRequired || winsB === winsRequired
    }
  }
  const score = await prepareAdminMatchScore(matchId, teamAId, teamBId, maps.some(map => map.played) ? winsA : null, maps.some(map => map.played) ? winsB : null)
  await db.batch([
    ...score.statements,
    db.prepare('DELETE FROM match_map WHERE match_id = ?').bind(matchId),
    ...maps.map((map, index) => db.prepare('INSERT INTO match_map (match_id,pick_order,map_name,action,chosen_by,score_a,score_b,played) VALUES (?,?,?,?,?,?,?,?)').bind(matchId, index + 1, map.mapName, map.action, map.chosenBy, map.scoreA, map.scoreB, map.played ? 1 : 0)),
  ])
  return { ...score.result, maps: maps.length }
}

export async function replaceMatchSchedule(
  tournamentId: number,
  matches: MatchScheduleInput[],
): Promise<MatchScheduleResult> {
  await requireAdmin()
  if (!matches.length || new Set(matches.map(match => match.id)).size !== matches.length) throw new Error('赛程场次无效')
  const { db } = cloudflareBindings()
  const current = await db.prepare('SELECT id, scheduled_at, source_match_a_id, source_match_b_id, round, team_a_id, team_b_id, winner_team_id, score_a, score_b FROM match WHERE tournament_id = ?').bind(tournamentId).all<{ id: number; scheduled_at: string | null; source_match_a_id: number | null; source_match_b_id: number | null; round: number; team_a_id: number | null; team_b_id: number | null; winner_team_id: number | null; score_a: number | null; score_b: number | null }>()
  const scheduled = new Map(matches.map(match => [match.id, match.scheduledAt]))
  const eligible = current.results.filter(match => !(match.round === 0 && !match.source_match_a_id && !match.source_match_b_id && match.winner_team_id && match.score_a === null && match.score_b === null && ((match.team_a_id === null) !== (match.team_b_id === null))))
  if (eligible.length !== matches.length || eligible.some(match => !scheduled.has(match.id))) throw new Error('赛程与当前签表不一致，请刷新后重试')
  for (const match of matches) {
    const stored = current.results.find(entry => entry.id === match.id)
    if (!stored || stored.scheduled_at !== match.expectedScheduledAt) throw new Error('赛程已被其他管理员修改，请刷新后重试')
  }
  for (const child of current.results) {
    const childTime = scheduled.get(child.id)
    if (!childTime) continue
    for (const parentId of [child.source_match_a_id, child.source_match_b_id]) {
      const parentTime = parentId ? scheduled.get(parentId) : null
      if (parentTime && childTime <= parentTime) throw new Error('下游比赛必须晚于上游比赛')
    }
  }
  await db.batch(matches.map(match => db.prepare('UPDATE match SET scheduled_at = ? WHERE id = ? AND tournament_id = ?').bind(match.scheduledAt, match.id, tournamentId)))
  return { ok: true, matches: matches.length, scheduled: matches.filter(match => match.scheduledAt).length, cleared: matches.filter(match => !match.scheduledAt).length }
}

export function removePhoto(id: number) {
  return adminMutation(() =>
    deletePrivateRows('photo', { filters: { id: `eq.${id}` } }),
  )
}

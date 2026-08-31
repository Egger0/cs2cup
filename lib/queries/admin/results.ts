import 'server-only'
import { requireAdmin } from '../../auth'
import { cloudflareBindings, type CloudflareD1Statement } from '../../cloudflare-bindings'
import type { MatchMapInput, MatchReportResult, MatchWriteResult } from './matches'

async function prepareAdminMatchScore(
  matchId: number,
  teamAId: number | null,
  teamBId: number | null,
  scoreA: number | null,
  scoreB: number | null,
): Promise<{
  db: ReturnType<typeof cloudflareBindings>['db']
  result: MatchWriteResult
  statements: CloudflareD1Statement[]
}> {
  const { db } = cloudflareBindings()
  const match = await db
    .prepare(
      'SELECT m.*, COALESCE(m.team_a_id, a.winner_team_id) AS resolved_a, COALESCE(m.team_b_id, b.winner_team_id) AS resolved_b FROM match m LEFT JOIN match a ON a.id = m.source_match_a_id LEFT JOIN match b ON b.id = m.source_match_b_id WHERE m.id = ?',
    )
    .bind(matchId)
    .first<{
      tournament_id: number
      round: number
      best_of: number
      team_a_id: number | null
      team_b_id: number | null
      source_match_a_id: number | null
      source_match_b_id: number | null
      winner_team_id: number | null
      resolved_a: number | null
      resolved_b: number | null
    }>()
  if (!match || match.resolved_a !== teamAId || match.resolved_b !== teamBId) {
    throw new Error('对阵双方已变化，请刷新后重试')
  }
  if ((scoreA === null) !== (scoreB === null)) {
    throw new Error('双方比分必须同时填写或同时清空')
  }
  const wins = Math.floor(match.best_of / 2) + 1
  if (
    scoreA !== null &&
    (scoreA < 0 ||
      scoreB! < 0 ||
      scoreA > wins ||
      scoreB! > wins ||
      (scoreA === wins && scoreB === wins))
  ) {
    throw new Error('比分无效')
  }
  const winner =
    scoreA === null
      ? match.round === 0 && (match.team_a_id === null) !== (match.team_b_id === null)
        ? (match.team_a_id ?? match.team_b_id)
        : null
      : scoreA === wins && scoreA > scoreB!
        ? teamAId
        : scoreB === wins && scoreB > scoreA
          ? teamBId
          : null
  const all = await db
    .prepare(
      'SELECT id, round, slot, source_match_a_id, source_match_b_id FROM match WHERE tournament_id = ?',
    )
    .bind(match.tournament_id)
    .all<{
      id: number
      round: number
      slot: number
      source_match_a_id: number | null
      source_match_b_id: number | null
    }>()
  const descendants = new Set<number>()
  const queue = [matchId]
  while (queue.length) {
    const parent = queue.shift()
    for (const child of all.results.filter(
      entry => entry.source_match_a_id === parent || entry.source_match_b_id === parent,
    )) {
      if (!descendants.has(child.id)) {
        descendants.add(child.id)
        queue.push(child.id)
      }
    }
  }
  const changed = match.winner_team_id !== winner
  const final = [...all.results].sort(
    (left, right) => right.round - left.round || left.slot - right.slot,
  )[0]
  const statements = [
    db
      .prepare('UPDATE match SET score_a = ?, score_b = ?, winner_team_id = ? WHERE id = ?')
      .bind(scoreA, scoreB, winner, matchId),
    ...(changed
      ? [...descendants].flatMap(id => [
          db.prepare('DELETE FROM match_map WHERE match_id = ?').bind(id),
          db
            .prepare(
              'UPDATE match SET score_a = NULL, score_b = NULL, winner_team_id = NULL WHERE id = ?',
            )
            .bind(id),
        ])
      : []),
    ...(final && (final.id === matchId || descendants.has(final.id))
      ? [
          db
            .prepare(
              'UPDATE tournament SET champion_name = (SELECT team.name FROM match LEFT JOIN team ON team.id = match.winner_team_id WHERE match.id = ?) WHERE id = ?',
            )
            .bind(final.id, match.tournament_id),
        ]
      : []),
  ]
  return {
    db,
    statements,
    result: {
      ok: true,
      tournamentId: match.tournament_id,
      matchId,
      scoreA,
      scoreB,
      winnerTeamId: winner,
      cleared: changed ? descendants.size : 0,
    },
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
  const match = await db
    .prepare(
      'SELECT m.best_of, t.map_pool FROM match m JOIN tournament t ON t.id = m.tournament_id WHERE m.id = ?',
    )
    .bind(matchId)
    .first<{ best_of: number; map_pool: string }>()
  if (!match) throw new Error('比赛不存在')
  const pool = JSON.parse(match.map_pool) as string[]
  if (!Array.isArray(maps) || maps.length === 0 || maps.length > pool.length) {
    throw new Error('地图战报无效')
  }
  const used = new Set<string>()
  let winsA = 0
  let winsB = 0
  const winsRequired = Math.floor(match.best_of / 2) + 1
  let seriesDecided = false
  for (const map of maps) {
    if (
      typeof map.mapName !== 'string' ||
      !pool.includes(map.mapName) ||
      used.has(map.mapName.toLowerCase()) ||
      !['ban', 'pick', 'decider'].includes(map.action) ||
      typeof map.played !== 'boolean' ||
      (map.action === 'decider' ? map.chosenBy !== null : !['a', 'b'].includes(map.chosenBy ?? ''))
    ) {
      throw new Error('地图战报无效')
    }
    used.add(map.mapName.toLowerCase())
    if (map.action === 'ban' && (map.played || map.scoreA !== null || map.scoreB !== null)) {
      throw new Error('被禁用的地图不能填写比分')
    }
    if (!map.played && (map.scoreA !== null || map.scoreB !== null)) {
      throw new Error('未进行地图不能填写比分')
    }
    if (map.played) {
      const scoreA = map.scoreA
      const scoreB = map.scoreB
      if (
        seriesDecided ||
        map.action === 'ban' ||
        scoreA === null ||
        scoreB === null ||
        !Number.isSafeInteger(scoreA) ||
        !Number.isSafeInteger(scoreB) ||
        scoreA < 0 ||
        scoreB < 0 ||
        scoreA === scoreB
      ) {
        throw new Error('已进行地图的比分无效')
      }
      if (scoreA > scoreB) winsA += 1
      else winsB += 1
      seriesDecided = winsA === winsRequired || winsB === winsRequired
    }
  }
  const score = await prepareAdminMatchScore(
    matchId,
    teamAId,
    teamBId,
    maps.some(map => map.played) ? winsA : null,
    maps.some(map => map.played) ? winsB : null,
  )
  await db.batch([
    ...score.statements,
    db.prepare('DELETE FROM match_map WHERE match_id = ?').bind(matchId),
    ...maps.map((map, index) =>
      db
        .prepare(
          'INSERT INTO match_map (match_id,pick_order,map_name,action,chosen_by,score_a,score_b,played) VALUES (?,?,?,?,?,?,?,?)',
        )
        .bind(
          matchId,
          index + 1,
          map.mapName,
          map.action,
          map.chosenBy,
          map.scoreA,
          map.scoreB,
          map.played ? 1 : 0,
        ),
    ),
  ])
  return { ...score.result, maps: maps.length }
}

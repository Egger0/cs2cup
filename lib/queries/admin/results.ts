import 'server-only'
import { requireAdmin } from '../../auth'
import { cloudflareBindings } from '../../cloudflare-bindings'
import type { MatchMapInput, MatchReportResult, MatchWriteResult } from './matches'
import { prepareAdminMatchScore } from './score-write'

export async function saveAdminMatchScore(
  matchId: number,
  teamAId: number | null,
  teamBId: number | null,
  scoreA: number | null,
  scoreB: number | null,
  confirmationToken: string | null = null,
): Promise<MatchWriteResult> {
  await requireAdmin()
  const change = await prepareAdminMatchScore(matchId, teamAId, teamBId, scoreA, scoreB, {
    confirmationToken,
  })
  await change.db.batch(change.statements)
  return change.result
}

export async function saveAdminMatchReport(
  matchId: number,
  teamAId: number,
  teamBId: number,
  maps: MatchMapInput[],
  confirmationToken: string | null = null,
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
  if (!Array.isArray(maps) || maps.length > pool.length) {
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
    { confirmationToken, replacingReport: true },
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

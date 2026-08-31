import 'server-only'
import { requireAdmin } from '../../auth'
import { cloudflareBindings } from '../../cloudflare-bindings'
import type { MatchScheduleInput, MatchScheduleResult } from './matches'

export async function replaceMatchSchedule(
  tournamentId: number,
  matches: MatchScheduleInput[],
): Promise<MatchScheduleResult> {
  await requireAdmin()
  if (!matches.length || new Set(matches.map(match => match.id)).size !== matches.length) {
    throw new Error('赛程场次无效')
  }
  const { db } = cloudflareBindings()
  const current = await db
    .prepare(
      'SELECT id, scheduled_at, source_match_a_id, source_match_b_id, round, team_a_id, team_b_id, winner_team_id, score_a, score_b FROM match WHERE tournament_id = ?',
    )
    .bind(tournamentId)
    .all<{
      id: number
      scheduled_at: string | null
      source_match_a_id: number | null
      source_match_b_id: number | null
      round: number
      team_a_id: number | null
      team_b_id: number | null
      winner_team_id: number | null
      score_a: number | null
      score_b: number | null
    }>()
  const scheduled = new Map(matches.map(match => [match.id, match.scheduledAt]))
  const eligible = current.results.filter(
    match =>
      !(
        match.round === 0 &&
        !match.source_match_a_id &&
        !match.source_match_b_id &&
        match.winner_team_id &&
        match.score_a === null &&
        match.score_b === null &&
        (match.team_a_id === null) !== (match.team_b_id === null)
      ),
  )
  if (eligible.length !== matches.length || eligible.some(match => !scheduled.has(match.id))) {
    throw new Error('赛程与当前签表不一致，请刷新后重试')
  }
  for (const match of matches) {
    const stored = current.results.find(entry => entry.id === match.id)
    if (!stored || stored.scheduled_at !== match.expectedScheduledAt) {
      throw new Error('赛程已被其他管理员修改，请刷新后重试')
    }
  }
  for (const child of current.results) {
    const childTime = scheduled.get(child.id)
    if (!childTime) continue
    for (const parentId of [child.source_match_a_id, child.source_match_b_id]) {
      const parentTime = parentId ? scheduled.get(parentId) : null
      if (parentTime && childTime <= parentTime) {
        throw new Error('下游比赛必须晚于上游比赛')
      }
    }
  }
  await db.batch(
    matches.map(match =>
      db
        .prepare('UPDATE match SET scheduled_at = ? WHERE id = ? AND tournament_id = ?')
        .bind(match.scheduledAt, match.id, tournamentId),
    ),
  )
  return {
    ok: true,
    matches: matches.length,
    scheduled: matches.filter(match => match.scheduledAt).length,
    cleared: matches.filter(match => !match.scheduledAt).length,
  }
}

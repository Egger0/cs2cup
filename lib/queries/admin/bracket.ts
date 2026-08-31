import 'server-only'
import { requireAdmin } from '../../auth'
import { cloudflareBindings } from '../../cloudflare-bindings'
import type { TeamStatus } from '../../types'
import type { BracketReplaceResult, TeamSeedResult } from './matches'

export async function replaceBracket(
  tournamentId: number,
  teamIds: number[],
  seedPositions: number[],
): Promise<BracketReplaceResult> {
  await requireAdmin()
  const { db } = cloudflareBindings()
  const approved = await db
    .prepare("SELECT id FROM team WHERE tournament_id = ? AND status = 'approved' ORDER BY id")
    .bind(tournamentId)
    .all<{ id: number }>()
  const input = [...teamIds].sort((a, b) => a - b)
  if (
    teamIds.length < 2 ||
    input.length !== approved.results.length ||
    input.some((id, index) => id !== approved.results[index]?.id)
  ) {
    throw new Error('传入战队必须与全部已通过审核的战队一致')
  }
  const size = seedPositions.length
  if (
    size < teamIds.length ||
    (size & (size - 1)) !== 0 ||
    new Set(seedPositions).size !== size ||
    Math.min(...seedPositions) !== 1 ||
    Math.max(...seedPositions) !== size
  ) {
    throw new Error('签位排列无效')
  }
  const firstPairs = Array.from({ length: size / 2 }, (_, slot) => ({
    a:
      seedPositions[slot * 2]! <= teamIds.length
        ? (teamIds[seedPositions[slot * 2]! - 1] ?? null)
        : null,
    b:
      seedPositions[slot * 2 + 1]! <= teamIds.length
        ? (teamIds[seedPositions[slot * 2 + 1]! - 1] ?? null)
        : null,
  }))
  if (firstPairs.some(pair => pair.a === null && pair.b === null)) {
    throw new Error('签位排列产生了空白首轮')
  }
  const replacement = [
    db.prepare('DELETE FROM match WHERE tournament_id = ?').bind(tournamentId),
    db.prepare('UPDATE team SET seed = NULL WHERE tournament_id = ?').bind(tournamentId),
    ...teamIds.map((id, index) =>
      db.prepare('UPDATE team SET seed = ? WHERE id = ?').bind(index + 1, id),
    ),
    db.prepare('UPDATE tournament SET champion_name = NULL WHERE id = ?').bind(tournamentId),
  ]
  const inserts = []
  let count = size / 2
  let round = 0
  while (count >= 1) {
    const label =
      count === 1
        ? '总决赛'
        : count === 2
          ? '半决赛'
          : count === 4
            ? '八强'
            : count === 8
              ? '16 强'
              : `第 ${round + 1} 轮`
    for (let slot = 0; slot < count; slot += 1) {
      inserts.push(
        db
          .prepare(
            'INSERT INTO match (tournament_id,round,slot,round_label,best_of,team_a_id,team_b_id,winner_team_id) VALUES (?,?,?,?,?,?,?,?)',
          )
          .bind(
            tournamentId,
            round,
            slot,
            label,
            count === 1 ? 5 : 3,
            round === 0 ? (firstPairs[slot]?.a ?? null) : null,
            round === 0 ? (firstPairs[slot]?.b ?? null) : null,
            round === 0 && (firstPairs[slot]?.a === null) !== (firstPairs[slot]?.b === null)
              ? (firstPairs[slot]?.a ?? firstPairs[slot]?.b ?? null)
              : null,
          ),
      )
    }
    count /= 2
    round += 1
  }
  await db.batch([
    ...replacement,
    ...inserts,
    db
      .prepare(
        `
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
    `,
      )
      .bind(tournamentId),
  ])
  return {
    ok: true,
    created: inserts.length,
    byes: firstPairs.filter(pair => (pair.a === null) !== (pair.b === null)).length,
    teams: teamIds.length,
  }
}

export async function assignTeamSeed(
  tournamentId: number,
  teamId: number,
  seed: number | null,
): Promise<TeamSeedResult> {
  await requireAdmin()
  const { db } = cloudflareBindings()
  const team = await db
    .prepare('SELECT status, seed FROM team WHERE id = ? AND tournament_id = ?')
    .bind(teamId, tournamentId)
    .first<{ status: TeamStatus; seed: number | null }>()
  if (!team) throw new Error('战队不存在')
  if (seed === null) {
    await db.prepare('UPDATE team SET seed = NULL WHERE id = ?').bind(teamId).run()
    return { ok: true, tournamentId, teamId, seed: null, swappedTeamId: null }
  }
  const approved = await db
    .prepare("SELECT COUNT(*) AS count FROM team WHERE tournament_id = ? AND status = 'approved'")
    .bind(tournamentId)
    .first<{ count: number }>()
  if (team.status !== 'approved' || seed < 1 || seed > (approved?.count ?? 0)) {
    throw new Error('种子号无效')
  }
  const conflict = await db
    .prepare(
      "SELECT id FROM team WHERE tournament_id = ? AND status = 'approved' AND id != ? AND seed = ?",
    )
    .bind(tournamentId, teamId, seed)
    .first<{ id: number }>()
  await db.batch([
    ...(conflict
      ? [db.prepare('UPDATE team SET seed = ? WHERE id = ?').bind(team.seed, conflict.id)]
      : []),
    db.prepare('UPDATE team SET seed = ? WHERE id = ?').bind(seed, teamId),
  ])
  return { ok: true, tournamentId, teamId, seed, swappedTeamId: conflict?.id ?? null }
}

import 'server-only'
import { cloudflareBindings, type CloudflareD1Statement } from '../../cloudflare-bindings'
import type { MatchWriteResult } from './matches'

interface ScoreWriteOptions {
  confirmationToken?: string | null
  replacingReport?: boolean
}

interface MatchScoreRow {
  id: number
  tournament_id: number
  round: number
  best_of: number
  team_a_id: number | null
  team_b_id: number | null
  score_a: number | null
  score_b: number | null
  winner_team_id: number | null
  resolved_a: number | null
  resolved_b: number | null
  report_rows: number
}

interface BracketRow {
  id: number
  round: number
  slot: number
  source_match_a_id: number | null
  source_match_b_id: number | null
  score_a: number | null
  score_b: number | null
  winner_team_id: number | null
  report_rows: number
}

interface MatchMapState {
  match_id: number
  pick_order: number
  map_name: string
  action: string
  chosen_by: string | null
  score_a: number | null
  score_b: number | null
  played: number
}

export class ScoreCorrectionConfirmationError extends Error {
  readonly affectedMatches: number
  readonly clearsCurrentReport: boolean
  readonly confirmationToken: string

  constructor(affectedMatches: number, clearsCurrentReport: boolean, confirmationToken: string) {
    super('score correction requires confirmation')
    this.name = 'ScoreCorrectionConfirmationError'
    this.affectedMatches = affectedMatches
    this.clearsCurrentReport = clearsCurrentReport
    this.confirmationToken = confirmationToken
  }
}

function descendantIds(matches: BracketRow[], matchId: number) {
  const descendants = new Set<number>()
  const queue = [matchId]
  while (queue.length > 0) {
    const parent = queue.shift()
    for (const child of matches) {
      if (
        !descendants.has(child.id) &&
        (child.source_match_a_id === parent || child.source_match_b_id === parent)
      ) {
        descendants.add(child.id)
        queue.push(child.id)
      }
    }
  }
  return descendants
}

async function stateToken(
  db: ReturnType<typeof cloudflareBindings>['db'],
  match: MatchScoreRow,
  matches: BracketRow[],
  descendants: Set<number>,
  proposed: [number | null, number | null, number | null],
) {
  const relevantIds = new Set([match.id, ...descendants])
  const maps = await db
    .prepare(
      'SELECT mm.match_id, mm.pick_order, mm.map_name, mm.action, mm.chosen_by, mm.score_a, mm.score_b, mm.played FROM match_map mm JOIN match m ON m.id = mm.match_id WHERE m.tournament_id = ? ORDER BY mm.match_id, mm.pick_order',
    )
    .bind(match.tournament_id)
    .all<MatchMapState>()
  const payload = JSON.stringify({
    current: [match.id, match.score_a, match.score_b, match.winner_team_id, match.report_rows],
    proposed,
    matches: matches
      .filter(entry => relevantIds.has(entry.id))
      .map(entry => [
        entry.id,
        entry.round,
        entry.slot,
        entry.source_match_a_id,
        entry.source_match_b_id,
        entry.score_a,
        entry.score_b,
        entry.winner_team_id,
        entry.report_rows,
      ]),
    maps: maps.results
      .filter(entry => relevantIds.has(entry.match_id))
      .map(entry => [
        entry.match_id,
        entry.pick_order,
        entry.map_name,
        entry.action,
        entry.chosen_by,
        entry.score_a,
        entry.score_b,
        entry.played,
      ]),
  })
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function prepareAdminMatchScore(
  matchId: number,
  teamAId: number | null,
  teamBId: number | null,
  scoreA: number | null,
  scoreB: number | null,
  options: ScoreWriteOptions = {},
): Promise<{
  db: ReturnType<typeof cloudflareBindings>['db']
  result: MatchWriteResult
  statements: CloudflareD1Statement[]
}> {
  const { db } = cloudflareBindings()
  const match = await db
    .prepare(
      'SELECT m.*, COALESCE(m.team_a_id, a.winner_team_id) AS resolved_a, COALESCE(m.team_b_id, b.winner_team_id) AS resolved_b, (SELECT COUNT(*) FROM match_map mm WHERE mm.match_id = m.id) AS report_rows FROM match m LEFT JOIN match a ON a.id = m.source_match_a_id LEFT JOIN match b ON b.id = m.source_match_b_id WHERE m.id = ?',
    )
    .bind(matchId)
    .first<MatchScoreRow>()
  if (!match || match.resolved_a !== teamAId || match.resolved_b !== teamBId) {
    throw new Error('对阵双方已变化，请刷新后重试')
  }
  if ((scoreA === null) !== (scoreB === null)) {
    throw new Error('双方比分必须同时填写或同时清空')
  }

  const wins = Math.floor(match.best_of / 2) + 1
  if (
    scoreA !== null &&
    scoreB !== null &&
    (!Number.isSafeInteger(scoreA) ||
      !Number.isSafeInteger(scoreB) ||
      scoreA < 0 ||
      scoreB < 0 ||
      scoreA > wins ||
      scoreB > wins ||
      (scoreA === wins && scoreB === wins))
  ) {
    throw new Error('比分无效')
  }

  const winner =
    scoreA === null || scoreB === null
      ? match.round === 0 && (match.team_a_id === null) !== (match.team_b_id === null)
        ? (match.team_a_id ?? match.team_b_id)
        : null
      : scoreA === wins && scoreA > scoreB
        ? teamAId
        : scoreB === wins && scoreB > scoreA
          ? teamBId
          : null
  const all = await db
    .prepare(
      'SELECT m.id, m.round, m.slot, m.source_match_a_id, m.source_match_b_id, m.score_a, m.score_b, m.winner_team_id, (SELECT COUNT(*) FROM match_map mm WHERE mm.match_id = m.id) AS report_rows FROM match m WHERE m.tournament_id = ? ORDER BY m.round, m.slot, m.id',
    )
    .bind(match.tournament_id)
    .all<BracketRow>()
  const descendants = descendantIds(all.results, matchId)
  const winnerChanged = match.winner_team_id !== winner
  const scoreChanged = match.score_a !== scoreA || match.score_b !== scoreB
  const clearsCurrentReport = !options.replacingReport && scoreChanged && match.report_rows > 0
  const resetsEstablishedWinner =
    match.winner_team_id !== null && winnerChanged && descendants.size > 0

  if (clearsCurrentReport || resetsEstablishedWinner) {
    const confirmationToken = await stateToken(db, match, all.results, descendants, [
      scoreA,
      scoreB,
      winner,
    ])
    if (options.confirmationToken !== confirmationToken) {
      throw new ScoreCorrectionConfirmationError(
        resetsEstablishedWinner ? descendants.size : 0,
        clearsCurrentReport,
        confirmationToken,
      )
    }
  }

  const final = [...all.results].sort(
    (left, right) => right.round - left.round || left.slot - right.slot,
  )[0]
  const statements = [
    db
      .prepare('UPDATE match SET score_a = ?, score_b = ?, winner_team_id = ? WHERE id = ?')
      .bind(scoreA, scoreB, winner, matchId),
    ...(clearsCurrentReport
      ? [db.prepare('DELETE FROM match_map WHERE match_id = ?').bind(matchId)]
      : []),
    ...(winnerChanged
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
      cleared: winnerChanged ? descendants.size : 0,
      reportCleared: clearsCurrentReport,
    },
  }
}

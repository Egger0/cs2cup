import 'server-only'

import type { IdentityDatabase } from './identity/internal/contracts.ts'
import { approvedMember, NBT_STAKE_LIMIT, nbtBalance, type PredictionStatus } from './nbt.ts'

export type PredictionPhase = 'open' | 'closed' | 'settled' | 'unavailable'

export interface PredictionSide {
  readonly id: number
  readonly name: string
  readonly tag: string
  readonly stake: number
  readonly backers: number
}

export interface MatchPredictionBoard {
  readonly phase: PredictionPhase
  readonly closesAt: string | null
  readonly winnerTeamId: number | null
  readonly sides: readonly [PredictionSide, PredictionSide] | null
  readonly viewer: 'anonymous' | 'member' | 'guest'
  readonly balance: number
  readonly mine: {
    readonly teamId: number
    readonly stake: number
    readonly status: PredictionStatus
    readonly delta: number
  } | null
}

interface BoardRow {
  tournamentStatus: string
  scheduledAt: string | null
  closesAtMs: number | null
  winnerTeamId: number | null
  teamAId: number | null
  teamAName: string | null
  teamATag: string | null
  teamBId: number | null
  teamBName: string | null
  teamBTag: string | null
  stakeA: number
  stakeB: number
  backersA: number
  backersB: number
}

function phaseOf(row: BoardRow, now: number): PredictionPhase {
  if (row.teamAId === null || row.teamBId === null) return 'unavailable'
  if (row.winnerTeamId !== null) return 'settled'
  if (row.closesAtMs === null) return 'unavailable'
  const live = ['registration', 'running', 'postponed'].includes(row.tournamentStatus)
  return live && row.closesAtMs > now ? 'open' : 'closed'
}

export async function matchPredictionBoard(
  database: IdentityDatabase,
  matchId: number,
  accountId: string | null,
  now: number,
): Promise<MatchPredictionBoard | null> {
  const row = await database
    .prepare(
      `SELECT tournament.status AS tournamentStatus, m.scheduled_at AS scheduledAt,
              unixepoch(m.scheduled_at) * 1000 AS closesAtMs, m.winner_team_id AS winnerTeamId,
              a.id AS teamAId, a.name AS teamAName, a.tag AS teamATag,
              b.id AS teamBId, b.name AS teamBName, b.tag AS teamBTag,
              pool.stake_a AS stakeA, pool.stake_b AS stakeB,
              pool.backers_a AS backersA, pool.backers_b AS backersB
       FROM match_public AS m
       JOIN tournament ON tournament.id = m.tournament_id
       JOIN match_prediction_pool AS pool ON pool.match_id = m.id
       LEFT JOIN team_public AS a ON a.id = m.team_a_id
       LEFT JOIN team_public AS b ON b.id = m.team_b_id
       WHERE m.id = ?`,
    )
    .bind(matchId)
    .first<BoardRow>()
  if (!row) return null

  const [member, balance, mine] = accountId
    ? await Promise.all([
        approvedMember(database, accountId),
        nbtBalance(database, accountId),
        database
          .prepare(
            `SELECT team_id AS teamId, stake, status, delta FROM match_prediction_outcome
             WHERE match_id = ? AND account_id = ?`,
          )
          .bind(matchId, accountId)
          .first<{ teamId: number; stake: number; status: PredictionStatus; delta: number }>(),
      ])
    : [false, 0, null]

  const sides =
    row.teamAId !== null && row.teamBId !== null
      ? ([
          {
            id: row.teamAId,
            name: row.teamAName ?? '',
            tag: row.teamATag ?? '',
            stake: Number(row.stakeA),
            backers: Number(row.backersA),
          },
          {
            id: row.teamBId,
            name: row.teamBName ?? '',
            tag: row.teamBTag ?? '',
            stake: Number(row.stakeB),
            backers: Number(row.backersB),
          },
        ] as const)
      : null

  return {
    phase: phaseOf(row, now),
    closesAt: row.scheduledAt,
    winnerTeamId: row.winnerTeamId,
    sides,
    viewer: !accountId ? 'anonymous' : member ? 'member' : 'guest',
    balance,
    mine: mine ? { ...mine, delta: Number(mine.delta) } : null,
  }
}

export type PlacePredictionResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly reason:
        | 'invalid_stake'
        | 'membership_required'
        | 'already_placed'
        | 'insufficient_balance'
        | 'closed'
    }

export async function placeMatchPrediction(
  database: IdentityDatabase,
  input: { accountId: string; matchId: number; teamId: number; stake: number },
  now: number,
): Promise<PlacePredictionResult> {
  const { accountId, matchId, teamId, stake } = input
  if (!Number.isSafeInteger(stake) || stake < 1 || stake > NBT_STAKE_LIMIT) {
    return { ok: false, reason: 'invalid_stake' }
  }
  if (!Number.isSafeInteger(matchId) || !Number.isSafeInteger(teamId)) {
    return { ok: false, reason: 'closed' }
  }
  try {
    await database
      .prepare(
        `INSERT INTO match_prediction (match_id, account_id, team_id, stake, placed_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(matchId, accountId, teamId, stake, now)
      .run()
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (!/match prediction rejected|UNIQUE constraint failed|FOREIGN KEY/i.test(message)) {
      throw error
    }
    const board = await matchPredictionBoard(database, matchId, accountId, now)
    if (board?.mine) return { ok: false, reason: 'already_placed' }
    if (board?.viewer === 'guest') return { ok: false, reason: 'membership_required' }
    if (board?.phase === 'open' && board.sides?.some(side => side.id === teamId)) {
      if (board.balance < stake) return { ok: false, reason: 'insufficient_balance' }
    }
    return { ok: false, reason: 'closed' }
  }
}

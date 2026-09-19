import 'server-only'

import type { IdentityDatabase } from './identity/internal/contracts.ts'
import { previousDate, shanghaiDate } from './qq-automation.ts'

export const STARDUST_REWARDS = { check_in: 10, matchday: 20 } as const
export const STARDUST_STAKE_LIMIT = 1000
export const MEMBERSHIP_REWARD_HINT = '成员资格审核通过后，签到才会发放星尘。'

export type StardustGrantKind = keyof typeof STARDUST_REWARDS
export type PredictionStatus = 'open' | 'won' | 'lost' | 'void'

export interface StardustPrediction {
  readonly matchId: number
  readonly tournamentSlug: string
  readonly tournamentTitle: string
  readonly roundLabel: string
  readonly teamName: string
  readonly stake: number
  readonly status: PredictionStatus
  readonly delta: number
  readonly placedAt: number
}

export interface StardustWallet {
  readonly eligible: boolean
  readonly balance: number
  readonly checkedInToday: boolean
  readonly matchdayToday: boolean
  readonly predictions: StardustPrediction[]
}

const APPROVED_MEMBER = `EXISTS (
  SELECT 1 FROM identity_membership
  WHERE account_id = ? AND status = 'approved' AND revoked_at IS NULL
)`

const RUNNING_TOURNAMENT = `EXISTS (SELECT 1 FROM tournament WHERE status = 'running')`

export function stardustGrantStatement(
  database: IdentityDatabase,
  accountId: string,
  kind: StardustGrantKind,
  now: number,
) {
  return database
    .prepare(
      `INSERT OR IGNORE INTO stardust_grant (account_id, kind, grant_date, amount, granted_at)
       SELECT ?, ?, ?, ?, ? WHERE ${APPROVED_MEMBER}
         ${kind === 'matchday' ? `AND ${RUNNING_TOURNAMENT}` : ''}`,
    )
    .bind(accountId, kind, shanghaiDate(now), STARDUST_REWARDS[kind], now, accountId)
}

export async function stardustGrantedAt(
  database: IdentityDatabase,
  accountId: string,
  kind: StardustGrantKind,
  now: number,
) {
  const row = await database
    .prepare(
      `SELECT granted_at AS grantedAt FROM stardust_grant
       WHERE account_id = ? AND kind = ? AND grant_date = ?`,
    )
    .bind(accountId, kind, shanghaiDate(now))
    .first<{ grantedAt: number }>()
  return row?.grantedAt ?? null
}

export async function approvedMember(database: IdentityDatabase, accountId: string) {
  const row = await database
    .prepare(`SELECT ${APPROVED_MEMBER} AS eligible`)
    .bind(accountId)
    .first<{ eligible: number }>()
  return row?.eligible === 1
}

export async function stardustBalance(database: IdentityDatabase, accountId: string) {
  const row = await database
    .prepare('SELECT balance FROM stardust_balance WHERE account_id = ?')
    .bind(accountId)
    .first<{ balance: number }>()
  return Number(row?.balance ?? 0)
}

export interface DailyCheckIn {
  readonly fresh: boolean
  readonly streak: number
  readonly signedAt: number
  readonly reward: number
}

export async function dailyCheckIn(
  database: IdentityDatabase,
  accountId: string,
  now: number,
): Promise<DailyCheckIn> {
  const today = shanghaiDate(now)
  await database.batch([
    database
      .prepare(
        `INSERT OR IGNORE INTO qq_daily_check_in (account_id, check_in_date, signed_at)
         VALUES (?, ?, ?)`,
      )
      .bind(accountId, today, now),
    database
      .prepare(
        `INSERT INTO qq_check_in_streak (account_id, current_streak, last_check_in_date, last_signed_at)
         SELECT ?, CASE
           WHEN (SELECT last_check_in_date FROM qq_check_in_streak WHERE account_id = ?) = ?
             THEN COALESCE((SELECT current_streak FROM qq_check_in_streak WHERE account_id = ?), 0) + 1
           ELSE 1
         END, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM qq_daily_check_in
           WHERE account_id = ? AND check_in_date = ? AND signed_at = ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM qq_check_in_streak
           WHERE account_id = ? AND last_check_in_date = ?
         )
         ON CONFLICT(account_id) DO UPDATE SET
           current_streak = excluded.current_streak,
           last_check_in_date = excluded.last_check_in_date,
           last_signed_at = excluded.last_signed_at`,
      )
      .bind(
        accountId,
        accountId,
        previousDate(today),
        accountId,
        today,
        now,
        accountId,
        today,
        now,
        accountId,
        today,
      ),
    stardustGrantStatement(database, accountId, 'check_in', now),
  ])
  const [streak, grantedAt] = await Promise.all([
    database
      .prepare(
        `SELECT current_streak AS streak, last_signed_at AS signedAt
         FROM qq_check_in_streak WHERE account_id = ? LIMIT 1`,
      )
      .bind(accountId)
      .first<{ streak: number; signedAt: number }>(),
    stardustGrantedAt(database, accountId, 'check_in', now),
  ])
  if (!streak) throw new Error('Daily check-in streak was not recorded')
  return {
    fresh: streak.signedAt === now,
    streak: streak.streak,
    signedAt: streak.signedAt,
    reward: grantedAt === now ? STARDUST_REWARDS.check_in : 0,
  }
}

export async function checkedInToday(database: IdentityDatabase, accountId: string, now: number) {
  const row = await database
    .prepare(
      'SELECT 1 AS present FROM qq_daily_check_in WHERE account_id = ? AND check_in_date = ?',
    )
    .bind(accountId, shanghaiDate(now))
    .first<{ present: number }>()
  return row !== null
}

interface PredictionRow {
  matchId: number
  tournamentSlug: string
  tournamentTitle: string
  roundLabel: string
  teamName: string
  stake: number
  status: PredictionStatus
  delta: number
  placedAt: number
}

export async function stardustWallet(
  database: IdentityDatabase,
  accountId: string,
  now: number,
): Promise<StardustWallet> {
  await stardustGrantStatement(database, accountId, 'matchday', now).run()
  const [eligible, balance, checkIn, matchday, predictions] = await Promise.all([
    approvedMember(database, accountId),
    stardustBalance(database, accountId),
    checkedInToday(database, accountId, now),
    stardustGrantedAt(database, accountId, 'matchday', now),
    database
      .prepare(
        `SELECT outcome.match_id AS matchId, tournament.slug AS tournamentSlug,
                tournament.title AS tournamentTitle, m.round_label AS roundLabel,
                team.name AS teamName, outcome.stake, outcome.status, outcome.delta,
                outcome.placed_at AS placedAt
         FROM match_prediction_outcome AS outcome
         JOIN match AS m ON m.id = outcome.match_id
         JOIN tournament ON tournament.id = m.tournament_id
         JOIN team ON team.id = outcome.team_id
         WHERE outcome.account_id = ?
         ORDER BY outcome.placed_at DESC
         LIMIT 12`,
      )
      .bind(accountId)
      .all<PredictionRow>(),
  ])
  return {
    eligible,
    balance,
    checkedInToday: checkIn,
    matchdayToday: matchday !== null,
    predictions: predictions.results.map(row => ({ ...row, delta: Number(row.delta) })),
  }
}

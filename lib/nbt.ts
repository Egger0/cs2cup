import 'server-only'

import type { IdentityDatabase } from './identity/internal/contracts.ts'
import { shanghaiDate } from './qq-automation.ts'

export const NBT_REWARDS = { check_in: 10, matchday: 20 } as const
export const NBT_STAKE_LIMIT = 1000

export type NbtGrantKind = keyof typeof NBT_REWARDS
export type PredictionStatus = 'open' | 'won' | 'lost' | 'void'

export interface NbtPrediction {
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

export interface NbtWallet {
  readonly eligible: boolean
  readonly balance: number
  readonly checkedInToday: boolean
  readonly matchdayToday: boolean
  readonly predictions: NbtPrediction[]
}

const APPROVED_MEMBER = `EXISTS (
  SELECT 1 FROM identity_membership
  WHERE account_id = ? AND status = 'approved' AND revoked_at IS NULL
)`

const RUNNING_TOURNAMENT = `EXISTS (SELECT 1 FROM tournament WHERE status = 'running')`

export function nbtGrantStatement(
  database: IdentityDatabase,
  accountId: string,
  kind: NbtGrantKind,
  now: number,
) {
  return database
    .prepare(
      `INSERT OR IGNORE INTO nbt_grant (account_id, kind, grant_date, amount, granted_at)
       SELECT ?, ?, ?, ?, ? WHERE ${APPROVED_MEMBER}
         ${kind === 'matchday' ? `AND ${RUNNING_TOURNAMENT}` : ''}`,
    )
    .bind(accountId, kind, shanghaiDate(now), NBT_REWARDS[kind], now, accountId)
}

export async function nbtGrantedAt(
  database: IdentityDatabase,
  accountId: string,
  kind: NbtGrantKind,
  now: number,
) {
  const row = await database
    .prepare(
      `SELECT granted_at AS grantedAt FROM nbt_grant
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

export async function nbtBalance(database: IdentityDatabase, accountId: string) {
  const row = await database
    .prepare('SELECT balance FROM nbt_balance WHERE account_id = ?')
    .bind(accountId)
    .first<{ balance: number }>()
  return Number(row?.balance ?? 0)
}

export type NbtCheckInResult =
  | { readonly ok: true; readonly reward: number }
  | { readonly ok: false; readonly reason: 'membership_required' | 'already_checked_in' }

export async function checkInForNbt(
  database: IdentityDatabase,
  accountId: string,
  now: number,
): Promise<NbtCheckInResult> {
  await nbtGrantStatement(database, accountId, 'check_in', now).run()
  const at = await nbtGrantedAt(database, accountId, 'check_in', now)
  if (at === now) return { ok: true, reward: NBT_REWARDS.check_in }
  if (at !== null) return { ok: false, reason: 'already_checked_in' }
  return { ok: false, reason: 'membership_required' }
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

export async function nbtWallet(
  database: IdentityDatabase,
  accountId: string,
  now: number,
): Promise<NbtWallet> {
  await nbtGrantStatement(database, accountId, 'matchday', now).run()
  const [eligible, balance, checkIn, matchday, predictions] = await Promise.all([
    approvedMember(database, accountId),
    nbtBalance(database, accountId),
    nbtGrantedAt(database, accountId, 'check_in', now),
    nbtGrantedAt(database, accountId, 'matchday', now),
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
    checkedInToday: checkIn !== null,
    matchdayToday: matchday !== null,
    predictions: predictions.results.map(row => ({ ...row, delta: Number(row.delta) })),
  }
}

import 'server-only'

import type { IdentityDatabase } from './identity/internal/contracts.ts'
import type { LoadoutInput } from './loadout-input.ts'
import {
  SELECT_CODE,
  fromRow,
  type LoadoutStatus,
  type ReviewLoadoutCode,
} from './loadout-queries.ts'

export const LOADOUT_PENDING_LIMIT = 5

export type SubmitLoadoutResult =
  | { readonly ok: true; readonly id: number }
  | { readonly ok: false; readonly reason: 'duplicate' | 'limit' | 'closed' }

export async function submitLoadoutCode(
  database: IdentityDatabase,
  input: { accountId: string; gameId: number; value: LoadoutInput; shotKey: string | null },
  now: number,
): Promise<SubmitLoadoutResult> {
  const { accountId, gameId, value, shotKey } = input
  const stats = value.stats
  try {
    const row = await database
      .prepare(
        `INSERT INTO loadout_code (game_id, account_id, mode, weapon, code, title, note, tags,
           price, recoil, handling, stability, hipfire, distance, shot_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .bind(
        gameId,
        accountId,
        value.mode,
        value.weapon,
        value.code,
        value.title,
        value.note,
        JSON.stringify(value.tags),
        value.price,
        stats?.recoil ?? null,
        stats?.handling ?? null,
        stats?.stability ?? null,
        stats?.hipfire ?? null,
        stats?.distance ?? null,
        shotKey,
        now,
      )
      .first<{ id: number }>()
    return { ok: true, id: Number(row?.id) }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/UNIQUE constraint failed: loadout_code\.game_id/i.test(message)) {
      return { ok: false, reason: 'duplicate' }
    }
    if (!/loadout code submission rejected/.test(message)) throw error
    const pending = await database
      .prepare(
        `SELECT COUNT(*) AS count FROM loadout_code WHERE account_id = ? AND status = 'pending'`,
      )
      .bind(accountId)
      .first<{ count: number }>()
    return {
      ok: false,
      reason: Number(pending?.count ?? 0) >= LOADOUT_PENDING_LIMIT ? 'limit' : 'closed',
    }
  }
}

export async function listLoadoutCodesForReview(database: IdentityDatabase): Promise<{
  pending: ReviewLoadoutCode[]
  reported: ReviewLoadoutCode[]
  shots: ReviewLoadoutCode[]
}> {
  const select = (where: string, order: string) =>
    database
      .prepare(
        `${SELECT_CODE.replace(
          'FROM loadout_code AS code',
          ', game.name AS gameName FROM loadout_code AS code',
        )}
         JOIN game ON game.id = code.game_id
         WHERE ${where} ORDER BY ${order} LIMIT 100`,
      )
      .bind()
      .all<Parameters<typeof fromRow>[0] & { gameName: string }>()
  const [pending, reported, shots] = await Promise.all([
    select(`code.status = 'pending'`, 'code.created_at ASC'),
    select(
      `code.status = 'approved' AND EXISTS (SELECT 1 FROM loadout_report WHERE code_id = code.id)`,
      'reports DESC, code.id ASC',
    ),
    select(`code.pending_shot_key IS NOT NULL`, 'code.id ASC'),
  ])
  return {
    pending: pending.results.map(fromRow),
    reported: reported.results.map(fromRow),
    shots: shots.results.map(fromRow),
  }
}

export type LoadoutDecision = 'approved' | 'rejected' | 'expired' | 'dismiss'

const DECISION_FROM: Record<LoadoutDecision, LoadoutStatus> = {
  approved: 'pending',
  rejected: 'pending',
  expired: 'approved',
  dismiss: 'approved',
}

export async function reviewLoadoutCode(
  database: IdentityDatabase,
  input: { id: number; reviewerAccountId: string; decision: LoadoutDecision },
  now: number,
): Promise<{ ok: true; gameSlug: string } | { ok: false }> {
  const { id, reviewerAccountId, decision } = input
  const statement =
    decision === 'dismiss'
      ? database
          .prepare(
            `DELETE FROM loadout_report WHERE code_id = (
               SELECT id FROM loadout_code WHERE id = ? AND status = 'approved')
             RETURNING (SELECT game.slug FROM loadout_code JOIN game ON game.id = loadout_code.game_id
               WHERE loadout_code.id = loadout_report.code_id) AS gameSlug`,
          )
          .bind(id)
      : database
          .prepare(
            `UPDATE loadout_code SET status = ?, reviewed_at = ?, reviewed_by_account_id = ?
             WHERE id = ? AND status = ?
             RETURNING (SELECT slug FROM game WHERE game.id = loadout_code.game_id) AS gameSlug`,
          )
          .bind(decision, now, reviewerAccountId, id, DECISION_FROM[decision])
  const row = await statement.first<{ gameSlug: string }>()
  return row ? { ok: true, gameSlug: row.gameSlug } : { ok: false }
}

export async function recordLoadoutCopy(database: IdentityDatabase, id: number) {
  await database
    .prepare(`UPDATE loadout_code SET copies = copies + 1 WHERE id = ? AND status = 'approved'`)
    .bind(id)
    .run()
}

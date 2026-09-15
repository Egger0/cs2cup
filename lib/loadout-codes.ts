import 'server-only'

import type { IdentityDatabase } from './identity/internal/contracts.ts'
import { CONTROL_CHARACTER } from './registration-form.ts'

export const LOADOUT_PENDING_LIMIT = 5

const LIMITS = { weapon: [1, 30], title: [1, 40], code: [4, 200], note: [0, 200] } as const

export type LoadoutField = keyof typeof LIMITS
export type LoadoutInput = Record<LoadoutField, string>
export type LoadoutStatus = 'pending' | 'approved' | 'rejected'

export interface LoadoutCode {
  readonly id: number
  readonly weapon: string
  readonly title: string
  readonly code: string
  readonly note: string | null
  readonly status: LoadoutStatus
  readonly authorName: string
  readonly authorHandle: string | null
  readonly createdAt: number
}

export interface PendingLoadoutCode extends LoadoutCode {
  readonly gameName: string
  readonly gameSlug: string
}

const SELECT_CODE = `SELECT code.id, code.weapon, code.title, code.code, code.note, code.status,
  account.display_name AS authorName, account.public_handle AS authorHandle,
  code.created_at AS createdAt
  FROM loadout_code AS code
  JOIN identity_account AS account ON account.id = code.account_id`

export function parseLoadoutInput(
  source: Partial<Record<LoadoutField, unknown>>,
): { ok: true; value: LoadoutInput } | { ok: false; field: LoadoutField } {
  const value = {} as LoadoutInput
  for (const [field, [min, max]] of Object.entries(LIMITS) as [
    LoadoutField,
    readonly [number, number],
  ][]) {
    const raw = source[field]
    const text = typeof raw === 'string' ? raw.trim() : ''
    const length = [...text].length
    if (length < min || length > max || CONTROL_CHARACTER.test(text)) return { ok: false, field }
    value[field] = text
  }
  return { ok: true, value }
}

export async function listLoadoutCodes(
  database: IdentityDatabase,
  gameId: number,
  limit = 60,
): Promise<LoadoutCode[]> {
  const { results } = await database
    .prepare(
      `${SELECT_CODE}
       WHERE code.game_id = ? AND code.status = 'approved' AND account.status = 'active'
       ORDER BY code.reviewed_at DESC, code.id DESC LIMIT ?`,
    )
    .bind(gameId, limit)
    .all<LoadoutCode>()
  return results
}

export async function listOwnLoadoutCodes(
  database: IdentityDatabase,
  gameId: number,
  accountId: string,
): Promise<LoadoutCode[]> {
  const { results } = await database
    .prepare(
      `${SELECT_CODE} WHERE code.game_id = ? AND code.account_id = ?
       ORDER BY code.created_at DESC LIMIT 20`,
    )
    .bind(gameId, accountId)
    .all<LoadoutCode>()
  return results
}

export type SubmitLoadoutResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'duplicate' | 'limit' | 'closed' }

export async function submitLoadoutCode(
  database: IdentityDatabase,
  input: { accountId: string; gameId: number; value: LoadoutInput },
  now: number,
): Promise<SubmitLoadoutResult> {
  const { accountId, gameId, value } = input
  try {
    await database
      .prepare(
        `INSERT INTO loadout_code (game_id, account_id, weapon, title, code, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(gameId, accountId, value.weapon, value.title, value.code, value.note || null, now)
      .run()
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/UNIQUE constraint failed/i.test(message)) return { ok: false, reason: 'duplicate' }
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

export async function listPendingLoadoutCodes(
  database: IdentityDatabase,
): Promise<PendingLoadoutCode[]> {
  const { results } = await database
    .prepare(
      `SELECT code.id, code.weapon, code.title, code.code, code.note, code.status,
              account.display_name AS authorName, account.public_handle AS authorHandle,
              code.created_at AS createdAt, game.name AS gameName, game.slug AS gameSlug
       FROM loadout_code AS code
       JOIN identity_account AS account ON account.id = code.account_id
       JOIN game ON game.id = code.game_id
       WHERE code.status = 'pending'
       ORDER BY code.created_at ASC LIMIT 100`,
    )
    .bind()
    .all<PendingLoadoutCode>()
  return results
}

export async function reviewLoadoutCode(
  database: IdentityDatabase,
  input: { id: number; reviewerAccountId: string; decision: 'approved' | 'rejected' },
  now: number,
): Promise<{ ok: true; gameSlug: string } | { ok: false }> {
  const row = await database
    .prepare(
      `UPDATE loadout_code SET status = ?, reviewed_at = ?, reviewed_by_account_id = ?
       WHERE id = ? AND status = 'pending'
       RETURNING (SELECT slug FROM game WHERE game.id = loadout_code.game_id) AS gameSlug`,
    )
    .bind(input.decision, now, input.reviewerAccountId, input.id)
    .first<{ gameSlug: string }>()
  return row ? { ok: true, gameSlug: row.gameSlug } : { ok: false }
}

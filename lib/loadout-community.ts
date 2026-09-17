import 'server-only'

import type { IdentityDatabase } from './identity/internal/contracts.ts'
import { CONTROL_CHARACTER } from './registration-form.ts'

export const LOADOUT_COMMENT_HOURLY_LIMIT = 10

export interface LoadoutComment {
  readonly id: number
  readonly body: string
  readonly authorId: string
  readonly authorName: string
  readonly authorHandle: string | null
  readonly hidden: boolean
  readonly createdAt: number
}

export async function listViewerLoadoutMarks(database: IdentityDatabase, accountId: string) {
  const { results } = await database
    .prepare(
      `SELECT code_id AS id, 'like' AS kind FROM loadout_like WHERE account_id = ?1
       UNION ALL
       SELECT code_id AS id, 'report' AS kind FROM loadout_report WHERE account_id = ?1
       UNION ALL
       SELECT code_id AS id, 'favorite' AS kind FROM loadout_favorite WHERE account_id = ?1`,
    )
    .bind(accountId)
    .all<{ id: number; kind: 'like' | 'report' | 'favorite' }>()
  const ids = (kind: string) => new Set(results.filter(row => row.kind === kind).map(row => row.id))
  return { liked: ids('like'), reported: ids('report'), saved: ids('favorite') }
}

export type LoadoutMarks = Awaited<ReturnType<typeof listViewerLoadoutMarks>>

async function guarded(statement: Promise<unknown>, guard: RegExp) {
  try {
    await statement
    return true
  } catch (error) {
    if (error instanceof Error && guard.test(error.message)) return false
    throw error
  }
}

export async function setLoadoutLike(
  database: IdentityDatabase,
  input: { id: number; accountId: string; liked: boolean },
  now: number,
): Promise<boolean> {
  if (!input.liked) {
    await database
      .prepare('DELETE FROM loadout_like WHERE code_id = ? AND account_id = ?')
      .bind(input.id, input.accountId)
      .run()
    return true
  }
  return guarded(
    database
      .prepare(
        `INSERT INTO loadout_like (code_id, account_id, created_at) VALUES (?, ?, ?)
         ON CONFLICT DO NOTHING`,
      )
      .bind(input.id, input.accountId, now)
      .run(),
    /loadout like rejected/,
  )
}

export async function setLoadoutFavorite(
  database: IdentityDatabase,
  input: { id: number; accountId: string; saved: boolean },
  now: number,
): Promise<boolean> {
  const row = input.saved
    ? await database
        .prepare(
          `INSERT INTO loadout_favorite (code_id, account_id, created_at)
           SELECT id, ?2, ?3 FROM loadout_code WHERE id = ?1 AND status IN ('approved', 'expired')
           ON CONFLICT DO UPDATE SET created_at = created_at RETURNING code_id`,
        )
        .bind(input.id, input.accountId, now)
        .first()
    : await database
        .prepare(
          'DELETE FROM loadout_favorite WHERE code_id = ? AND account_id = ? RETURNING code_id',
        )
        .bind(input.id, input.accountId)
        .first()
  return input.saved ? Boolean(row) : true
}

export async function setLoadoutFeatured(
  database: IdentityDatabase,
  input: { id: number; featured: boolean },
  now: number,
): Promise<string | null> {
  const row = await database
    .prepare(
      `UPDATE loadout_code SET featured_at = CASE WHEN ?1 THEN ?2 ELSE NULL END
       WHERE id = ?3 AND status = 'approved'
       RETURNING (SELECT slug FROM game WHERE game.id = loadout_code.game_id) AS gameSlug`,
    )
    .bind(input.featured ? 1 : 0, now, input.id)
    .first<{ gameSlug: string }>()
  return row?.gameSlug ?? null
}

export function reportLoadoutCode(
  database: IdentityDatabase,
  input: { id: number; accountId: string },
  now: number,
): Promise<boolean> {
  return guarded(
    database
      .prepare(
        `INSERT INTO loadout_report (code_id, account_id, created_at) VALUES (?, ?, ?)
         ON CONFLICT DO NOTHING`,
      )
      .bind(input.id, input.accountId, now)
      .run(),
    /loadout report rejected/,
  )
}

export async function listLoadoutComments(
  database: IdentityDatabase,
  codeId: number,
  includeHidden: boolean,
): Promise<LoadoutComment[]> {
  const { results } = await database
    .prepare(
      `SELECT comment.id, comment.body, comment.account_id AS authorId,
              account.display_name AS authorName, account.public_handle AS authorHandle,
              comment.hidden_at IS NOT NULL AS hidden, comment.created_at AS createdAt
       FROM loadout_comment AS comment
       JOIN identity_account AS account ON account.id = comment.account_id
       WHERE comment.code_id = ? AND account.status = 'active'
         AND (? OR comment.hidden_at IS NULL)
       ORDER BY comment.created_at ASC, comment.id ASC LIMIT 200`,
    )
    .bind(codeId, includeHidden ? 1 : 0)
    .all<Omit<LoadoutComment, 'hidden'> & { hidden: number }>()
  return results.map(row => ({ ...row, hidden: Boolean(row.hidden) }))
}

export function parseLoadoutComment(raw: unknown) {
  const body = typeof raw === 'string' ? raw.trim().replace(/\r\n?/g, '\n') : ''
  const length = [...body].length
  return length < 1 || length > 300 || CONTROL_CHARACTER.test(body.replaceAll('\n', ' '))
    ? null
    : body
}

export async function postLoadoutComment(
  database: IdentityDatabase,
  input: { id: number; accountId: string; body: string },
  now: number,
): Promise<{ ok: true } | { ok: false; reason: 'limit' | 'closed' }> {
  const posted = await guarded(
    database
      .prepare(
        'INSERT INTO loadout_comment (code_id, account_id, body, created_at) VALUES (?, ?, ?, ?)',
      )
      .bind(input.id, input.accountId, input.body, now)
      .run(),
    /loadout comment rejected/,
  )
  if (posted) return { ok: true }
  const recent = await database
    .prepare(
      'SELECT COUNT(*) AS count FROM loadout_comment WHERE account_id = ? AND created_at > ?',
    )
    .bind(input.accountId, now - 3_600_000)
    .first<{ count: number }>()
  return {
    ok: false,
    reason: Number(recent?.count ?? 0) >= LOADOUT_COMMENT_HOURLY_LIMIT ? 'limit' : 'closed',
  }
}

export async function removeLoadoutComment(
  database: IdentityDatabase,
  input: { commentId: number; accountId: string; moderator: boolean },
  now: number,
): Promise<boolean> {
  const row = input.moderator
    ? await database
        .prepare(
          `UPDATE loadout_comment SET hidden_at = ? WHERE id = ? AND hidden_at IS NULL
           RETURNING id`,
        )
        .bind(now, input.commentId)
        .first()
    : await database
        .prepare('DELETE FROM loadout_comment WHERE id = ? AND account_id = ? RETURNING id')
        .bind(input.commentId, input.accountId)
        .first()
  return Boolean(row)
}

export async function listSavedLoadouts(database: IdentityDatabase, accountId: string) {
  const { results } = await database
    .prepare(
      `SELECT code.id, code.title, code.weapon, code.mode, code.status, code.source,
              game.slug AS gameSlug
       FROM loadout_favorite AS favorite
       JOIN loadout_code AS code ON code.id = favorite.code_id
       JOIN game ON game.id = code.game_id
       WHERE favorite.account_id = ? AND code.status IN ('approved', 'expired')
       ORDER BY favorite.created_at DESC LIMIT 12`,
    )
    .bind(accountId)
    .all<{
      id: number
      title: string
      weapon: string
      mode: 'operations' | 'warfare'
      status: 'approved' | 'expired'
      source: 'member' | 'official'
      gameSlug: string
    }>()
  return results
}

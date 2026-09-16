import 'server-only'

import { LOADOUT_MODES, formatPrice, matchLoadoutQuery, shareString } from './delta-loadouts.ts'
import type { IdentityDatabase } from './identity/internal/contracts.ts'
import type { LoadoutInput, LoadoutStats } from './loadout-input.ts'

export const LOADOUT_PENDING_LIMIT = 5

export type LoadoutStatus = 'pending' | 'approved' | 'rejected' | 'expired'

export interface LoadoutCode extends LoadoutInput {
  readonly id: number
  readonly shotKey: string | null
  readonly status: LoadoutStatus
  readonly copies: number
  readonly reports: number
  readonly likes: number
  readonly comments: number
  readonly authorName: string
  readonly authorHandle: string | null
  readonly gameSlug: string
  readonly createdAt: number
}

export interface ReviewLoadoutCode extends LoadoutCode {
  readonly gameName: string
}

interface LoadoutRow extends Omit<LoadoutCode, 'tags' | 'stats'> {
  readonly tags: string
  readonly recoil: number | null
  readonly handling: number | null
  readonly stability: number | null
  readonly hipfire: number | null
  readonly distance: number | null
}

const SELECT_CODE = `SELECT code.id, code.mode, code.weapon, code.code, code.title, code.note, code.tags,
  code.price, code.recoil, code.handling, code.stability, code.hipfire, code.distance,
  code.shot_key AS shotKey, code.status, code.copies,
  (SELECT COUNT(*) FROM loadout_report WHERE code_id = code.id) AS reports,
  (SELECT COUNT(*) FROM loadout_like WHERE code_id = code.id) AS likes,
  (SELECT COUNT(*) FROM loadout_comment WHERE code_id = code.id AND hidden_at IS NULL) AS comments,
  account.display_name AS authorName, account.public_handle AS authorHandle,
  (SELECT slug FROM game WHERE game.id = code.game_id) AS gameSlug, code.created_at AS createdAt
  FROM loadout_code AS code
  JOIN identity_account AS account ON account.id = code.account_id`

function fromRow<T extends LoadoutRow>(source: T) {
  const { tags, recoil, handling, stability, hipfire, distance, ...row } = source
  const stats =
    recoil === null ? null : ({ recoil, handling, stability, hipfire, distance } as LoadoutStats)
  return { ...row, tags: JSON.parse(tags) as string[], stats }
}

async function listPublic(database: IdentityDatabase, where: string, ...values: unknown[]) {
  const { results } = await database
    .prepare(
      `${SELECT_CODE}
       WHERE ${where} AND code.status IN ('approved', 'expired') AND account.status = 'active'
       ORDER BY code.reviewed_at DESC, code.id DESC LIMIT 600`,
    )
    .bind(...values)
    .all<LoadoutRow>()
  return results.map(fromRow)
}

export function listLoadoutCodes(
  database: IdentityDatabase,
  gameId: number,
): Promise<LoadoutCode[]> {
  return listPublic(database, 'code.game_id = ?', gameId)
}

export async function getLoadoutCode(
  database: IdentityDatabase,
  gameId: number,
  id: number,
): Promise<LoadoutCode | null> {
  return (await listPublic(database, 'code.game_id = ? AND code.id = ?', gameId, id))[0] ?? null
}

export function listAuthorLoadoutCodes(
  database: IdentityDatabase,
  accountId: string,
): Promise<LoadoutCode[]> {
  return listPublic(database, `code.account_id = ? AND code.status = 'approved'`, accountId)
}

export async function listOwnLoadoutCodes(
  database: IdentityDatabase,
  accountId: string,
  gameId: number | null = null,
): Promise<LoadoutCode[]> {
  const { results } = await database
    .prepare(
      `${SELECT_CODE} WHERE code.account_id = ?1 AND (?2 IS NULL OR code.game_id = ?2)
       ORDER BY code.created_at DESC LIMIT 20`,
    )
    .bind(accountId, gameId)
    .all<LoadoutRow>()
  return results.map(fromRow)
}

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

export async function listLoadoutCodesForReview(
  database: IdentityDatabase,
): Promise<{ pending: ReviewLoadoutCode[]; reported: ReviewLoadoutCode[] }> {
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
      .all<LoadoutRow & { gameName: string }>()
  const [pending, reported] = await Promise.all([
    select(`code.status = 'pending'`, 'code.created_at ASC'),
    select(
      `code.status = 'approved' AND EXISTS (SELECT 1 FROM loadout_report WHERE code_id = code.id)`,
      'reports DESC, code.id ASC',
    ),
  ])
  return { pending: pending.results.map(fromRow), reported: reported.results.map(fromRow) }
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

export async function loadoutShotAccess(
  database: IdentityDatabase,
  shotKey: string,
): Promise<{ status: LoadoutStatus; accountId: string } | null> {
  return database
    .prepare(`SELECT status, account_id AS accountId FROM loadout_code WHERE shot_key = ? LIMIT 1`)
    .bind(shotKey)
    .first<{ status: LoadoutStatus; accountId: string }>()
}

export async function loadoutDigest(database: IdentityDatabase, query: string, origin: string) {
  const game = await database
    .prepare('SELECT id, slug FROM game WHERE active = 1 AND loadout_codes = 1 ORDER BY id LIMIT 1')
    .bind()
    .first<{ id: number; slug: string }>()
  if (!game) return '改枪码暂未开放。'
  const list = `${origin}/games/${game.slug}/loadouts`
  const { mode, weapons, label, unmatched } = matchLoadoutQuery(query)
  if (unmatched) return `没认出「${query}」这把枪，试试“/改枪码 M4A1”或“/改枪码 冲锋枪”。\n${list}`
  const names = weapons && new Set(weapons.map(weapon => weapon.name))
  const top = (await listLoadoutCodes(database, game.id))
    .filter(
      code =>
        code.status === 'approved' &&
        (!mode || code.mode === mode) &&
        (!names || names.has(code.weapon)),
    )
    .sort((a, b) => b.copies + b.likes * 3 - (a.copies + a.likes * 3))
    .slice(0, 3)
  const scope = [label, mode && LOADOUT_MODES[mode]].filter(Boolean).join(' · ')
  if (!top.length)
    return `还没有${scope ? `「${scope}」的` : ''}改枪码，来当第一个枪匠：\n${list}#loadout-submit`
  return [
    `热门改枪码${scope ? ` · ${scope}` : ''}`,
    ...top.flatMap((code, index) => [
      `${index + 1}. ${code.title}${code.price ? ` · 约${formatPrice(code.price)}` : ''} · 复制 ${code.copies}`,
      shareString(code.weapon, code.mode, code.code),
    ]),
    `${list}?${new URLSearchParams({
      ...(mode === 'warfare' ? { mode } : {}),
      ...(weapons?.length === 1 ? { class: weapons[0]!.category, weapon: weapons[0]!.name } : {}),
    })}`.replace(/\?$/, ''),
  ].join('\n')
}

export async function searchLoadoutCodes(database: IdentityDatabase, term: string) {
  const like = `%${term.replace(/[\\%_]/g, character => `\\${character}`)}%`
  const { results } = await database
    .prepare(
      `SELECT code.id, code.title, code.weapon, code.mode, game.slug AS gameSlug
       FROM loadout_code AS code
       JOIN game ON game.id = code.game_id AND game.active = 1 AND game.loadout_codes = 1
       JOIN identity_account AS account ON account.id = code.account_id AND account.status = 'active'
       WHERE code.status = 'approved'
         AND (code.title LIKE ?1 ESCAPE '\\' OR code.weapon LIKE ?1 ESCAPE '\\'
           OR code.note LIKE ?1 ESCAPE '\\')
       ORDER BY code.copies DESC, code.id DESC LIMIT 8`,
    )
    .bind(like)
    .all<{
      id: number
      title: string
      weapon: string
      mode: LoadoutCode['mode']
      gameSlug: string
    }>()
  return results.map(row => ({
    title: row.title,
    subtitle: `${row.weapon} · ${LOADOUT_MODES[row.mode]}`,
    href: `/games/${row.gameSlug}/loadouts/${row.id}`,
  }))
}

import 'server-only'

import { findWeapon, type LoadoutMode } from './delta-loadouts.ts'
import type { IdentityDatabase } from './identity/internal/contracts.ts'
import type { LoadoutInput, LoadoutStats } from './loadout-input.ts'

export type LoadoutStatus = 'pending' | 'approved' | 'rejected' | 'expired'
export type LoadoutSource = 'member' | 'official'
export type LoadoutSort = 'hot' | 'usage' | 'new'

export interface LoadoutCode extends Omit<LoadoutInput, 'tags'> {
  readonly id: number
  readonly source: LoadoutSource
  readonly tags: readonly string[]
  readonly maps: readonly string[]
  readonly accessories: readonly number[]
  readonly baseStats: LoadoutStats | null
  readonly renderUrl: string | null
  readonly authorChannel: string | null
  readonly applyCount: number
  readonly officialLikes: number
  readonly shotKey: string | null
  readonly pendingShotKey: string | null
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

type LoadoutRow = Omit<LoadoutCode, 'tags' | 'maps' | 'accessories' | 'stats' | 'baseStats'> & {
  readonly tags: string
  readonly maps: string
  readonly accessories: string
  readonly baseStats: string | null
  readonly recoil: number | null
  readonly handling: number | null
  readonly stability: number | null
  readonly hipfire: number | null
  readonly distance: number | null
}

export const SELECT_CODE = `SELECT code.id, code.source, code.mode, code.weapon, code.code, code.title,
  code.note, code.tags, code.maps, code.accessories, code.price, code.recoil, code.handling,
  code.stability, code.hipfire, code.distance,
  COALESCE(code.base_stats, (SELECT stats FROM loadout_weapon WHERE name = code.weapon)) AS baseStats,
  code.render_url AS renderUrl, code.author_channel AS authorChannel,
  code.apply_count AS applyCount, code.official_likes AS officialLikes,
  code.shot_key AS shotKey, code.pending_shot_key AS pendingShotKey, code.status, code.copies,
  (SELECT COUNT(*) FROM loadout_report WHERE code_id = code.id) AS reports,
  (SELECT COUNT(*) FROM loadout_like WHERE code_id = code.id) AS likes,
  (SELECT COUNT(*) FROM loadout_comment WHERE code_id = code.id AND hidden_at IS NULL) AS comments,
  COALESCE(account.display_name, code.author_name) AS authorName,
  account.public_handle AS authorHandle,
  (SELECT slug FROM game WHERE game.id = code.game_id) AS gameSlug, code.created_at AS createdAt
  FROM loadout_code AS code
  LEFT JOIN identity_account AS account ON account.id = code.account_id`

const VISIBLE = `(code.source = 'official' OR account.status = 'active')`

export function fromRow<T extends LoadoutRow>(source: T) {
  const {
    tags,
    maps,
    accessories,
    baseStats,
    recoil,
    handling,
    stability,
    hipfire,
    distance,
    ...row
  } = source
  const stats =
    recoil === null ? null : ({ recoil, handling, stability, hipfire, distance } as LoadoutStats)
  return {
    ...row,
    tags: JSON.parse(tags) as string[],
    maps: JSON.parse(maps) as string[],
    accessories: JSON.parse(accessories) as number[],
    baseStats: baseStats ? (JSON.parse(baseStats) as LoadoutStats) : null,
    stats,
  }
}

export interface LoadoutFilter {
  readonly mode?: LoadoutMode | null
  readonly source?: LoadoutSource | null
  readonly weapons?: readonly string[] | null
  readonly price?: readonly [number, number] | null
  readonly tag?: string | null
  readonly map?: string | null
  readonly status?: 'approved' | 'expired'
  readonly excludeId?: number | null
}

const ORDER: Record<LoadoutSort, string> = {
  hot: 'code.copies + likes * 3 DESC, code.apply_count DESC, code.id DESC',
  usage: 'code.apply_count + code.copies DESC, code.id DESC',
  new: 'COALESCE(code.reviewed_at, code.created_at) DESC, code.id DESC',
}

function where(gameId: number, filter: LoadoutFilter) {
  return {
    clause: `code.game_id = ?1 AND code.status = ?2 AND (?3 IS NULL OR code.mode = ?3)
      AND (?4 IS NULL OR code.source = ?4)
      AND (?5 IS NULL OR code.weapon IN (SELECT value FROM json_each(?5)))
      AND (?6 IS NULL OR code.price BETWEEN ?6 AND ?7)
      AND (?8 IS NULL OR EXISTS (SELECT 1 FROM json_each(code.tags) WHERE value = ?8))
      AND (?9 IS NULL OR EXISTS (SELECT 1 FROM json_each(code.maps) WHERE value = ?9))
      AND (?10 IS NULL OR code.id != ?10) AND ${VISIBLE}`,
    values: [
      gameId,
      filter.status ?? 'approved',
      filter.mode ?? null,
      filter.source ?? null,
      filter.weapons ? JSON.stringify(filter.weapons) : null,
      filter.price?.[0] ?? null,
      filter.price?.[1] ?? null,
      filter.tag ?? null,
      filter.map ?? null,
      filter.excludeId ?? null,
    ],
  }
}

export async function queryLoadoutCodes(
  database: IdentityDatabase,
  gameId: number,
  filter: LoadoutFilter,
  options: { sort?: LoadoutSort; limit: number; offset?: number },
): Promise<{ codes: LoadoutCode[]; total: number }> {
  const { clause, values } = where(gameId, filter)
  const [page, total] = await Promise.all([
    database
      .prepare(
        `${SELECT_CODE} WHERE ${clause} ORDER BY ${ORDER[options.sort ?? 'hot']}
         LIMIT ?11 OFFSET ?12`,
      )
      .bind(...values, options.limit, options.offset ?? 0)
      .all<LoadoutRow>(),
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM loadout_code AS code
         LEFT JOIN identity_account AS account ON account.id = code.account_id WHERE ${clause}`,
      )
      .bind(...values)
      .first<{ count: number }>(),
  ])
  return { codes: page.results.map(fromRow), total: Number(total?.count ?? 0) }
}

export async function loadoutFacets(
  database: IdentityDatabase,
  gameId: number,
  filter: Pick<LoadoutFilter, 'mode' | 'source'>,
) {
  const scoped = `FROM loadout_code AS code
    LEFT JOIN identity_account AS account ON account.id = code.account_id
    WHERE code.game_id = ?1 AND code.status = 'approved' AND ${VISIBLE}`
  const narrowed = `${scoped} AND code.mode = ?2 AND (?3 IS NULL OR code.source = ?3)`
  const bind = [gameId, filter.mode ?? 'operations', filter.source ?? null]
  const [groups, weapons, tags, maps] = await Promise.all([
    database
      .prepare(`SELECT code.mode, code.source, COUNT(*) AS count ${scoped} GROUP BY 1, 2`)
      .bind(gameId)
      .all<{ mode: LoadoutMode; source: LoadoutSource; count: number }>(),
    database
      .prepare(
        `SELECT code.weapon AS name, weapon.category, COUNT(*) AS count ${narrowed.replace(
          'LEFT JOIN identity_account',
          'LEFT JOIN loadout_weapon AS weapon ON weapon.name = code.weapon LEFT JOIN identity_account',
        )} GROUP BY 1, 2 ORDER BY count DESC`,
      )
      .bind(...bind)
      .all<{ name: string; category: string | null; count: number }>(),
    database
      .prepare(
        `SELECT tag.value AS name, COUNT(*) AS count ${narrowed.replace(
          'WHERE',
          ', json_each(code.tags) AS tag WHERE',
        )} GROUP BY 1 ORDER BY count DESC LIMIT 10`,
      )
      .bind(...bind)
      .all<{ name: string; count: number }>(),
    database
      .prepare(
        `SELECT place.value AS name, COUNT(*) AS count ${narrowed.replace(
          'WHERE',
          ', json_each(code.maps) AS place WHERE',
        )} GROUP BY 1 ORDER BY count DESC LIMIT 12`,
      )
      .bind(...bind)
      .all<{ name: string; count: number }>(),
  ])
  return {
    groups: groups.results,
    weapons: weapons.results.map(row => ({
      ...row,
      category: row.category ?? findWeapon(row.name)?.category ?? '特殊武器',
    })),
    tags: tags.results,
    maps: maps.results,
  }
}

async function selectVisible(database: IdentityDatabase, clause: string, ...values: unknown[]) {
  const { results } = await database
    .prepare(
      `${SELECT_CODE} WHERE ${clause} AND code.status IN ('approved', 'expired') AND ${VISIBLE}
       ORDER BY code.reviewed_at DESC, code.id DESC LIMIT 200`,
    )
    .bind(...values)
    .all<LoadoutRow>()
  return results.map(fromRow)
}

export async function getLoadoutCode(database: IdentityDatabase, gameId: number, id: number) {
  return (await selectVisible(database, 'code.game_id = ? AND code.id = ?', gameId, id))[0] ?? null
}

export function listAuthorLoadoutCodes(database: IdentityDatabase, accountId: string) {
  return selectVisible(database, `code.account_id = ? AND code.status = 'approved'`, accountId)
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

export async function findLoadoutByCode(database: IdentityDatabase, gameId: number, code: string) {
  return database
    .prepare(
      `SELECT code.id, code.source, code.status, code.title,
              COALESCE(account.display_name, code.author_name) AS authorName
       FROM loadout_code AS code
       LEFT JOIN identity_account AS account ON account.id = code.account_id
       WHERE code.game_id = ? AND code.code = ?`,
    )
    .bind(gameId, code)
    .first<{
      id: number
      source: LoadoutSource
      status: LoadoutStatus
      title: string
      authorName: string
    }>()
}

export async function listLoadoutAccessories(database: IdentityDatabase, ids: readonly number[]) {
  if (!ids.length) return []
  const { results } = await database
    .prepare(
      `SELECT object_id AS id, name, slot, grade, image_url AS imageUrl, price, effects
       FROM loadout_accessory WHERE object_id IN (SELECT value FROM json_each(?))`,
    )
    .bind(JSON.stringify(ids))
    .all<{
      id: number
      name: string
      slot: string
      grade: number
      imageUrl: string | null
      price: number | null
      effects: string
    }>()
  const byId = new Map(results.map(row => [row.id, row]))
  return ids.flatMap(id => {
    const row = byId.get(id)
    return row
      ? [{ ...row, effects: JSON.parse(row.effects) as { value: string; positive: boolean }[] }]
      : []
  })
}

import 'server-only'

import {
  LOADOUT_MODES,
  formatPrice,
  matchLoadoutQuery,
  shareString,
  type LoadoutMode,
} from './delta-loadouts.ts'
import type { IdentityDatabase } from './identity/internal/contracts.ts'
import {
  getLoadoutCode,
  queryLoadoutCodes,
  randomLoadoutId,
  type LoadoutSource,
} from './loadout-queries.ts'

const VISIBLE = `(code.source = 'official' OR account.status = 'active')`

export async function listLoadoutSitemap(database: IdentityDatabase) {
  const { results } = await database
    .prepare(
      `SELECT code.id, game.slug AS gameSlug FROM loadout_code AS code
       JOIN game ON game.id = code.game_id AND game.active = 1 AND game.loadout_codes = 1
       LEFT JOIN identity_account AS account ON account.id = code.account_id
       WHERE code.status = 'approved' AND ${VISIBLE} LIMIT 5000`,
    )
    .bind()
    .all<{ id: number; gameSlug: string }>()
  return results
}

export async function loadoutDigest(database: IdentityDatabase, query: string, origin: string) {
  const game = await database
    .prepare('SELECT id, slug FROM game WHERE active = 1 AND loadout_codes = 1 ORDER BY id LIMIT 1')
    .bind()
    .first<{ id: number; slug: string }>()
  if (!game) return '改枪码暂未开放。'
  const list = `${origin}/games/${game.slug}/loadouts`
  if (query === '随机') {
    const id = await randomLoadoutId(database, game.id, {})
    const pick = id ? await getLoadoutCode(database, game.id, id) : null
    if (!pick) return `改枪码库还是空的，来当第一个枪匠：\n${list}#loadout-submit`
    return [
      `随机来一把：${pick.title}`,
      `${pick.weapon} · ${LOADOUT_MODES[pick.mode]}${pick.price ? ` · 约${formatPrice(pick.price)}` : ''}`,
      shareString(pick.weapon, pick.mode, pick.code),
      `${list}/${pick.id}`,
    ].join('\n')
  }
  const { mode, weapons, label, unmatched } = matchLoadoutQuery(query)
  if (unmatched) return `没认出「${query}」这把枪，试试“/改枪码 M4A1”或“/改枪码 冲锋枪”。\n${list}`
  const { codes: top } = await queryLoadoutCodes(
    database,
    game.id,
    { mode, weapons: weapons?.map(weapon => weapon.name) },
    { limit: 3 },
  )
  const scope = [label, mode && LOADOUT_MODES[mode]].filter(Boolean).join(' · ')
  if (!top.length)
    return `还没有${scope ? `「${scope}」的` : ''}改枪码，来当第一个枪匠：\n${list}#loadout-submit`
  return [
    `热门改枪码${scope ? ` · ${scope}` : ''}`,
    ...top.flatMap((code, index) => [
      `${index + 1}. ${code.title}${code.price ? ` · 约${formatPrice(code.price)}` : ''} · ${
        code.source === 'official' ? `官方精选 ${code.authorName}` : `复制 ${code.copies}`
      }`,
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
      `SELECT code.id, code.title, code.weapon, code.mode, code.source, game.slug AS gameSlug
       FROM loadout_code AS code
       JOIN game ON game.id = code.game_id AND game.active = 1 AND game.loadout_codes = 1
       LEFT JOIN identity_account AS account ON account.id = code.account_id
       WHERE code.status = 'approved' AND ${VISIBLE}
         AND (code.title LIKE ?1 ESCAPE '\\' OR code.weapon LIKE ?1 ESCAPE '\\'
           OR code.note LIKE ?1 ESCAPE '\\' OR code.author_name LIKE ?1 ESCAPE '\\')
       ORDER BY code.source = 'member' DESC, code.copies + code.apply_count DESC LIMIT 8`,
    )
    .bind(like)
    .all<{
      id: number
      title: string
      weapon: string
      mode: LoadoutMode
      source: LoadoutSource
      gameSlug: string
    }>()
  return results.map(row => ({
    title: row.title,
    subtitle: `${row.weapon} · ${LOADOUT_MODES[row.mode]}${row.source === 'official' ? ' · 官方精选' : ''}`,
    href: `/games/${row.gameSlug}/loadouts/${row.id}`,
  }))
}

import 'server-only'

import { findWeapon, type LoadoutMode } from './delta-loadouts.ts'
import type { IdentityDatabase } from './identity/internal/contracts.ts'
import type { LoadoutFilter, LoadoutSource } from './loadout-queries.ts'

const VISIBLE = `(code.source = 'official' OR account.status = 'active')`

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

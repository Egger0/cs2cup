import type { IdentityDatabase } from './identity/internal/contracts.ts'
import {
  clip,
  count,
  normalizeOfficialLoadout,
  record,
  stats,
  text,
  url,
  type Json,
  type OfficialLoadout,
} from './loadout-official.ts'

const ENDPOINT = 'https://comm.ams.game.qq.com/ide/'
const PAGE_LIMIT = 60
const BATCH = 40

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

async function ide(fetcher: Fetch, method: string, param: Json) {
  const query = new URLSearchParams({
    iChartId: '352143',
    iSubChartId: '352143',
    sIdeToken: 'YWRywA',
    source: '2',
    method,
    param: JSON.stringify(param),
  })
  const response = await fetcher(`${ENDPOINT}?${query}`, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`official ${method} answered ${response.status}`)
  const payload = record(await response.json())
  const data = record(record(record(payload?.jData)?.data)?.data)
  if (payload?.ret !== 0 || !data) throw new Error(`official ${method} failed`)
  return data
}

function chunks<T>(items: readonly T[]) {
  return Array.from({ length: Math.ceil(items.length / BATCH) }, (_, index) =>
    items.slice(index * BATCH, (index + 1) * BATCH),
  )
}

export async function syncOfficialLoadouts(
  database: IdentityDatabase,
  fetcher: Fetch,
  now: number,
) {
  const game = await database
    .prepare('SELECT id FROM game WHERE active = 1 AND loadout_codes = 1 ORDER BY id LIMIT 1')
    .bind()
    .first<{ id: number }>()
  if (!game) return { skipped: true as const }

  const [guns, accessories] = await Promise.all([
    ide(fetcher, 'dfm/object.list', { primary: 'gun', second: '', objectID: '' }),
    ide(fetcher, 'dfm/object.list', { primary: 'acc', second: '', objectID: '' }),
  ])
  const solutions = new Map<string, OfficialLoadout>()
  let complete = false
  for (let page = 1; page <= PAGE_LIMIT; page += 1) {
    const data = await ide(fetcher, 'dfm/solution.arms.list', {
      page,
      limit: 20,
      solutionType: 'gun',
    })
    if (!Array.isArray(data.list)) {
      complete = page > 1
      break
    }
    for (const raw of data.list) {
      const loadout = normalizeOfficialLoadout(raw)
      const known = loadout && solutions.get(loadout.code)
      if (loadout && (!known || known.applyCount < loadout.applyCount)) {
        solutions.set(loadout.code, loadout)
      }
    }
  }

  const { results: taken } = await database
    .prepare('SELECT code, official_id AS officialId FROM loadout_code WHERE game_id = ?')
    .bind(game.id)
    .all<{ code: string; officialId: number | null }>()
  const owners = new Map(taken.map(row => [row.code, row.officialId]))
  const { results: officialIds } = await database
    .prepare(
      'SELECT official_id AS officialId, code FROM loadout_code WHERE official_id IS NOT NULL',
    )
    .bind()
    .all<{ officialId: number; code: string }>()
  const codeOfId = new Map(officialIds.map(row => [row.officialId, row.code]))
  const writable = [...solutions.values()].filter(loadout => {
    const owner = owners.get(loadout.code)
    const previous = codeOfId.get(loadout.officialId)
    return (
      (owner === undefined || owner === loadout.officialId) &&
      (previous === undefined || previous === loadout.code)
    )
  })

  const statements = [
    ...(Array.isArray(guns.list) ? guns.list : []).flatMap(raw => {
      const gun = record(raw)
      const base = stats(record(gun?.gunDetail))
      const id = gun?.objectID
      if (!gun || typeof id !== 'number' || !base || !text(gun.objectName)) return []
      return [
        database
          .prepare(
            `INSERT INTO loadout_weapon (object_id, name, category, image_url, stats, synced_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(object_id) DO UPDATE SET name = ?2, category = ?3, image_url = ?4,
               stats = ?5, synced_at = ?6`,
          )
          .bind(
            id,
            clip(text(gun.objectName), 30),
            clip(text(gun.secondClassCN), 20) || '其他',
            url(gun.pic),
            JSON.stringify(base),
            now,
          ),
      ]
    }),
    ...(Array.isArray(accessories.list) ? accessories.list : []).flatMap(raw => {
      const acc = record(raw)
      const id = acc?.objectID
      const name = clip(text(acc?.objectName), 40)
      if (!acc || typeof id !== 'number' || !name) return []
      const detail = record(acc.accDetail)
      const effects = (['advantage', 'disadvantage'] as const).flatMap(side =>
        (Array.isArray(record(detail?.[side])?.effectList)
          ? (record(detail?.[side])!.effectList as unknown[])
          : []
        )
          .map(effect => clip(text(record(effect)?.value), 40))
          .filter(Boolean)
          .map(value => ({ value, positive: side === 'advantage' })),
      )
      return [
        database
          .prepare(
            `INSERT INTO loadout_accessory
               (object_id, name, slot, grade, image_url, price, effects, synced_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(object_id) DO UPDATE SET name = ?2, slot = ?3, grade = ?4,
               image_url = ?5, price = ?6, effects = ?7, synced_at = ?8`,
          )
          .bind(
            id,
            name,
            clip(text(acc.secondClassCN), 20) || '配件',
            count(acc.grade),
            url(acc.pic),
            count(acc.avgPrice) || null,
            JSON.stringify(effects),
            now,
          ),
      ]
    }),
    ...writable.map(loadout =>
      database
        .prepare(
          `INSERT INTO loadout_code (
             game_id, source, official_id, author_name, author_channel, mode, weapon, code,
             title, note, tags, maps, price, recoil, handling, stability, hipfire, distance,
             base_stats, render_url, accessories, apply_count, official_likes, status,
             created_at, reviewed_at, synced_at
           ) VALUES (?1, 'official', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
             ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, 'approved', ?23, ?24, ?24)
           ON CONFLICT(official_id) DO UPDATE SET author_name = ?3, author_channel = ?4,
             mode = ?5, weapon = ?6, title = ?8, note = ?9, tags = ?10, maps = ?11, price = ?12,
             recoil = ?13, handling = ?14, stability = ?15, hipfire = ?16, distance = ?17,
             base_stats = ?18, render_url = ?19, accessories = ?20, apply_count = ?21,
             official_likes = ?22, status = 'approved', synced_at = ?24`,
        )
        .bind(
          game.id,
          loadout.officialId,
          loadout.authorName,
          loadout.authorChannel,
          loadout.mode,
          loadout.weapon,
          loadout.code,
          loadout.title,
          loadout.note,
          JSON.stringify(loadout.tags),
          JSON.stringify(loadout.maps),
          loadout.price,
          loadout.stats?.recoil ?? null,
          loadout.stats?.handling ?? null,
          loadout.stats?.stability ?? null,
          loadout.stats?.hipfire ?? null,
          loadout.stats?.distance ?? null,
          loadout.baseStats && JSON.stringify(loadout.baseStats),
          loadout.renderUrl,
          JSON.stringify(loadout.accessories),
          loadout.applyCount,
          loadout.officialLikes,
          loadout.createdAt || now,
          now,
        ),
    ),
  ]
  for (const chunk of chunks(statements)) await database.batch(chunk)

  let expired = 0
  if (complete && writable.length) {
    const row = await database
      .prepare(
        `UPDATE loadout_code SET status = 'expired'
         WHERE source = 'official' AND status = 'approved' AND synced_at < ?
         RETURNING id`,
      )
      .bind(now)
      .all()
    expired = row.results.length
  }
  return { skipped: false as const, solutions: writable.length, expired, complete }
}

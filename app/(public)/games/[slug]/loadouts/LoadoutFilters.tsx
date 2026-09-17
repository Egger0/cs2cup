import Link from 'next/link'
import {
  LOADOUT_MODES,
  PRICE_TIERS,
  WEAPON_CATEGORIES,
  findWeapon,
  type LoadoutMode,
  type PriceTier,
} from '@/lib/delta-loadouts'
import type { LoadoutSort, LoadoutSource, loadoutFacets } from '@/lib/loadout-queries'
import styles from './loadouts.module.css'

export interface BrowseState {
  readonly mode: LoadoutMode
  readonly source: LoadoutSource | null
  readonly class: string | null
  readonly weapon: string | null
  readonly price: PriceTier | null
  readonly map: string | null
  readonly tag: string | null
  readonly sort: LoadoutSort
  readonly page: number
}

type Patch = Partial<Record<keyof BrowseState, string | number | null>>
const SOURCES = { member: '社员投稿', official: '官方精选' } as const
const SORTS = { hot: '社团热度', usage: '使用最多', new: '最新收录' } as const

export function browseHref(slug: string, state: BrowseState, patch: Patch) {
  const next: Patch = { page: null, ...patch }
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries({ ...state, ...next })) {
    const skip =
      value === null ||
      (key === 'mode' && value === 'operations') ||
      (key === 'sort' && value === 'hot') ||
      (key === 'page' && value === 1)
    if (!skip) query.set(key, String(value))
  }
  const text = query.toString()
  return `/games/${slug}/loadouts${text ? `?${text}` : ''}#loadout-browse`
}

export function LoadoutFilters({
  slug,
  state,
  facets,
  total,
}: {
  slug: string
  state: BrowseState
  facets: Awaited<ReturnType<typeof loadoutFacets>>
  total: number
}) {
  const href = (patch: Patch) => browseHref(slug, state, patch)
  const chip = (label: string, active: boolean, target: string, count?: number) => (
    <Link
      key={label}
      href={target}
      className={styles.chip}
      aria-current={active ? 'true' : undefined}
      scroll={false}
    >
      {label}
      {count === undefined ? null : <small>{count}</small>}
    </Link>
  )
  const modeCount = (mode: LoadoutMode, source?: LoadoutSource) =>
    facets.groups
      .filter(group => group.mode === mode && (!source || group.source === source))
      .reduce((sum, group) => sum + group.count, 0)
  const categories = new Map<string, number>()
  for (const weapon of facets.weapons) {
    categories.set(weapon.category, (categories.get(weapon.category) ?? 0) + weapon.count)
  }
  const weapons = facets.weapons.filter(weapon => weapon.category === state.class)
  const filtered = Boolean(state.class || state.weapon || state.price || state.map || state.tag)
  const row = (label: string, children: React.ReactNode) => (
    <div className={styles.filterRow} role="group" aria-label={label}>
      <span className={styles.filterLabel}>{label}</span>
      {children}
    </div>
  )

  return (
    <>
      <nav className={styles.modes} aria-label="模式">
        {(Object.keys(LOADOUT_MODES) as LoadoutMode[]).map(entry => (
          <Link
            key={entry}
            href={href({
              mode: entry,
              class: null,
              weapon: null,
              price: null,
              map: null,
              tag: null,
            })}
            aria-current={entry === state.mode ? 'page' : undefined}
            scroll={false}
          >
            {LOADOUT_MODES[entry]}
            <small>{modeCount(entry)}</small>
          </Link>
        ))}
      </nav>

      <div className={styles.filters}>
        {row(
          '来源',
          <>
            {chip('全部', !state.source, href({ source: null }), modeCount(state.mode))}
            {(Object.keys(SOURCES) as LoadoutSource[]).map(entry =>
              chip(
                SOURCES[entry],
                entry === state.source,
                href({ source: entry }),
                modeCount(state.mode, entry),
              ),
            )}
          </>,
        )}
        {categories.size
          ? row(
              '枪种',
              <>
                {chip('全部', !state.class, href({ class: null, weapon: null }))}
                {WEAPON_CATEGORIES.filter(entry => categories.has(entry)).map(entry =>
                  chip(
                    entry,
                    entry === state.class,
                    href({ class: entry, weapon: null }),
                    categories.get(entry),
                  ),
                )}
              </>,
            )
          : null}
        {weapons.length > 1
          ? row(
              '武器',
              <>
                {chip('全部', !state.weapon, href({ weapon: null }))}
                {weapons.map(entry =>
                  chip(
                    findWeapon(entry.name)?.short ?? entry.name,
                    entry.name === state.weapon,
                    href({ weapon: entry.name }),
                    entry.count,
                  ),
                )}
              </>,
            )
          : null}
        {state.mode === 'operations'
          ? row(
              '价格',
              <>
                {chip('不限', !state.price, href({ price: null }))}
                {(Object.keys(PRICE_TIERS) as PriceTier[]).map(entry =>
                  chip(PRICE_TIERS[entry][0], entry === state.price, href({ price: entry })),
                )}
              </>,
            )
          : null}
        {facets.maps.length
          ? row(
              '地图',
              <>
                {chip('不限', !state.map, href({ map: null }))}
                {facets.maps.map(entry =>
                  chip(
                    entry.name,
                    entry.name === state.map,
                    href({ map: entry.name }),
                    entry.count,
                  ),
                )}
              </>,
            )
          : null}
        {facets.tags.length
          ? row(
              '标签',
              <>
                {chip('不限', !state.tag, href({ tag: null }))}
                {facets.tags.map(entry =>
                  chip(
                    entry.name,
                    entry.name === state.tag,
                    href({ tag: entry.name }),
                    entry.count,
                  ),
                )}
              </>,
            )
          : null}
      </div>

      <div className={styles.resultBar}>
        <p>
          <b>{total}</b> 套{LOADOUT_MODES[state.mode]}方案
          {filtered ? (
            <Link
              href={href({ class: null, weapon: null, price: null, map: null, tag: null })}
              scroll={false}
            >
              清除筛选
            </Link>
          ) : null}
        </p>
        <nav className={styles.sort} aria-label="排序">
          {(Object.keys(SORTS) as LoadoutSort[]).map(entry =>
            chip(SORTS[entry], entry === state.sort, href({ sort: entry })),
          )}
        </nav>
      </div>
    </>
  )
}

export function LoadoutPager({
  slug,
  state,
  pages,
}: {
  slug: string
  state: BrowseState
  pages: number
}) {
  if (pages <= 1) return null
  return (
    <nav className={styles.pager} aria-label="翻页">
      {state.page > 1 ? (
        <Link href={browseHref(slug, state, { ...state, page: state.page - 1 })} scroll={false}>
          ← 上一页
        </Link>
      ) : (
        <span />
      )}
      <span>
        {state.page} / {pages}
      </span>
      {state.page < pages ? (
        <Link href={browseHref(slug, state, { ...state, page: state.page + 1 })} scroll={false}>
          下一页 →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  )
}

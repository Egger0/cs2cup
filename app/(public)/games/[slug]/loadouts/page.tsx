import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageMasthead, SectionHead } from '@/components/domain/Sections'
import { ButtonLink, Empty } from '@/components/ui'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import {
  LOADOUT_MODES,
  LOADOUT_TAGS,
  PRICE_TIERS,
  WEAPON_CATEGORIES,
  findWeapon,
  type LoadoutMode,
  type PriceTier,
} from '@/lib/delta-loadouts'
import { getAuthContext } from '@/lib/identity/kernel'
import { listLoadoutCodes, listOwnLoadoutCodes, type LoadoutCode } from '@/lib/loadout-codes'
import { listViewerLoadoutMarks } from '@/lib/loadout-community'
import { PLANET_COLORS } from '@/lib/planets'
import { getGame } from '@/lib/queries/public'
import { LoadoutCards } from './LoadoutCards'
import { HeroStats, HeroWeapon } from './LoadoutHero'
import { LoadoutSubmitForm } from './LoadoutSubmitForm'
import styles from './loadouts.module.css'

export const dynamic = 'force-dynamic'

type Search = Partial<Record<'mode' | 'class' | 'weapon' | 'price' | 'tag' | 'sort', string>>

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const game = await getGame((await params).slug).catch(() => null)
  return { title: game ? `${game.name} 改枪码` : '改枪码' }
}

function pick<T extends string>(value: string | undefined, allowed: readonly T[]) {
  return allowed.includes(value as T) ? (value as T) : null
}

function tally<T extends string>(codes: readonly LoadoutCode[], key: (code: LoadoutCode) => T[]) {
  const counts = new Map<T, number>()
  for (const code of codes)
    for (const value of key(code)) counts.set(value, (counts.get(value) ?? 0) + 1)
  return counts
}

export default async function LoadoutsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Search>
}) {
  const [{ slug }, search] = await Promise.all([params, searchParams])
  const game = await getGame(slug)
  if (!game?.loadoutCodes) notFound()
  const db = cloudflareBindings().db
  const context = await getAuthContext()
  const accountId =
    context.kind === 'authenticated' && !context.session.recoveryRestricted
      ? context.account.id
      : null
  const [codes, own, marks] = await Promise.all([
    listLoadoutCodes(db, game.id),
    accountId ? listOwnLoadoutCodes(db, accountId, game.id) : Promise.resolve([]),
    accountId ? listViewerLoadoutMarks(db, accountId) : Promise.resolve(null),
  ])

  const modes = Object.keys(LOADOUT_MODES) as LoadoutMode[]
  const mode = pick(search.mode, modes) ?? 'operations'
  const inMode = codes.filter(code => code.mode === mode)
  const live = inMode.filter(code => code.status === 'approved')
  const expired = inMode.filter(code => code.status === 'expired')
  const modeCounts = tally(
    codes.filter(code => code.status === 'approved'),
    code => [code.mode],
  )

  const categoryCounts = tally(live, code => {
    const category = findWeapon(code.weapon)?.category
    return category ? [category] : []
  })
  const category = pick(search.class, WEAPON_CATEGORIES)
  const inCategory = category
    ? live.filter(code => findWeapon(code.weapon)?.category === category)
    : live
  const weaponCounts = tally(inCategory, code => [code.weapon])
  const weapon = search.weapon && weaponCounts.has(search.weapon) ? search.weapon : null
  const tiers = Object.keys(PRICE_TIERS) as PriceTier[]
  const price = mode === 'operations' ? pick(search.price, tiers) : null
  const tag = pick(search.tag, LOADOUT_TAGS)
  const sort = search.sort === 'new' || search.sort === 'liked' ? search.sort : 'hot'

  const shown = inCategory
    .filter(code => !weapon || code.weapon === weapon)
    .filter(code => {
      if (!price) return true
      const [, min, max] = PRICE_TIERS[price]
      return code.price !== null && code.price >= min && code.price <= max
    })
    .filter(code => !tag || code.tags.includes(tag))
    .sort((a, b) =>
      sort === 'hot' ? b.copies - a.copies : sort === 'liked' ? b.likes - a.likes : 0,
    )
  const tagCounts = tally(inCategory, code => [...code.tags])

  const state = { mode, class: category, weapon, price, tag, sort: sort === 'hot' ? null : sort }
  const href = (patch: Partial<Record<keyof typeof state, string | null>>) => {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries({ ...state, ...patch })) {
      if (value && !(key === 'mode' && value === 'operations')) query.set(key, value)
    }
    const text = query.toString()
    return `/games/${game.slug}/loadouts${text ? `?${text}` : ''}#loadout-browse`
  }
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
  const filtered = Boolean(category || weapon || price || tag)
  const published = codes.filter(code => code.status === 'approved')
  const hero = published.reduce<LoadoutCode | null>(
    (best, code) => (!best || code.copies > best.copies ? code : best),
    null,
  )
  const heroImage = hero && findWeapon(hero.weapon)?.image

  return (
    <>
      <PageMasthead
        code="LOADOUT"
        tone={PLANET_COLORS.get(game.slug)}
        eyebrow={`${game.name} / 改枪码`}
        title="改枪码"
        lede="枪匠们压箱底的改装方案。复制完整改枪码，到改枪台「方案 → 方案共享」一贴即用。"
        density="compact"
        art={heroImage ? <HeroWeapon image={heroImage} /> : undefined}
      >
        <ButtonLink href="#loadout-browse" variant="primary">
          挑一套方案
        </ButtonLink>
        <ButtonLink href="#loadout-submit">投稿我的改枪码</ButtonLink>
        <HeroStats
          items={[
            ['套方案', published.length],
            ['次复制', published.reduce((sum, code) => sum + code.copies, 0)],
            ['位枪匠', new Set(published.map(code => code.authorName)).size],
          ]}
        />
      </PageMasthead>

      <section className="section" id="loadout-browse">
        <div className="wrap">
          <nav className={styles.modes} aria-label="模式">
            {modes.map(entry => (
              <Link
                key={entry}
                href={href({ mode: entry, class: null, weapon: null, price: null, tag: null })}
                aria-current={entry === mode ? 'page' : undefined}
                scroll={false}
              >
                {LOADOUT_MODES[entry]}
                <small>{modeCounts.get(entry) ?? 0}</small>
              </Link>
            ))}
          </nav>

          {live.length ? (
            <div className={styles.filters}>
              <div className={styles.filterRow} role="group" aria-label="枪种">
                <span className={styles.filterLabel}>枪种</span>
                {chip('全部', !category, href({ class: null, weapon: null }), live.length)}
                {WEAPON_CATEGORIES.filter(entry => categoryCounts.has(entry)).map(entry =>
                  chip(
                    entry,
                    entry === category,
                    href({ class: entry, weapon: null }),
                    categoryCounts.get(entry),
                  ),
                )}
              </div>
              {category && weaponCounts.size > 1 ? (
                <div className={styles.filterRow} role="group" aria-label="武器">
                  <span className={styles.filterLabel}>武器</span>
                  {chip('全部', !weapon, href({ weapon: null }))}
                  {[...weaponCounts].map(([name, count]) =>
                    chip(
                      findWeapon(name)?.short ?? name,
                      name === weapon,
                      href({ weapon: name }),
                      count,
                    ),
                  )}
                </div>
              ) : null}
              {mode === 'operations' ? (
                <div className={styles.filterRow} role="group" aria-label="价格">
                  <span className={styles.filterLabel}>价格</span>
                  {chip('不限', !price, href({ price: null }))}
                  {tiers.map(entry =>
                    chip(PRICE_TIERS[entry][0], entry === price, href({ price: entry })),
                  )}
                </div>
              ) : null}
              {tagCounts.size ? (
                <div className={styles.filterRow} role="group" aria-label="标签">
                  <span className={styles.filterLabel}>标签</span>
                  {chip('不限', !tag, href({ tag: null }))}
                  {LOADOUT_TAGS.filter(entry => tagCounts.has(entry)).map(entry =>
                    chip(entry, entry === tag, href({ tag: entry }), tagCounts.get(entry)),
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className={styles.resultBar}>
            <p>
              <b>{shown.length}</b> 套{LOADOUT_MODES[mode]}方案
              {filtered ? (
                <Link
                  href={href({ class: null, weapon: null, price: null, tag: null })}
                  scroll={false}
                >
                  清除筛选
                </Link>
              ) : null}
            </p>
            <nav className={styles.sort} aria-label="排序">
              {chip('最多复制', sort === 'hot', href({ sort: null }))}
              {chip('最多好用', sort === 'liked', href({ sort: 'liked' }))}
              {chip('最新通过', sort === 'new', href({ sort: 'new' }))}
            </nav>
          </div>

          {shown.length ? (
            <LoadoutCards codes={shown} marks={marks} />
          ) : (
            <Empty
              action={
                <ButtonLink href="#loadout-submit" variant="primary">
                  投稿一套
                </ButtonLink>
              }
            >
              {filtered
                ? '这个组合还没人改出来，换个条件，或者你来当第一个枪匠。'
                : `${LOADOUT_MODES[mode]}还是一片空白，第一套方案等你来填。`}
            </Empty>
          )}

          {expired.length ? (
            <details className={styles.expired}>
              <summary>已失效的方案 · {expired.length}</summary>
              <p>版本更迭后这些码已经导不进去了，配件思路还能参考。</p>
              <LoadoutCards codes={expired} />
            </details>
          ) : null}
        </div>
      </section>

      <div className="divider" />

      <section className="section" id="loadout-submit">
        <div className={`wrap ${styles.submit}`}>
          <SectionHead
            eyebrow="投稿"
            title="分享你的改枪码"
            lede="在改枪台「方案 → 方案共享」复制改枪码，粘贴到下面会自动认出武器和模式。每条投稿都会先经过社团审核，同一时间最多 5 条待审核。"
          />
          {accountId ? (
            <>
              <LoadoutSubmitForm slug={game.slug} />
              {own.length ? (
                <div className={styles.own}>
                  <h3>我的投稿</h3>
                  <LoadoutCards codes={own} mine />
                </div>
              ) : null}
            </>
          ) : (
            <Empty
              action={
                <ButtonLink href="/login" variant="primary">
                  登录后投稿
                </ButtonLink>
              }
            >
              投稿需要登录账号，审核通过后会署名展示。<Link href="/register">还没有账号？</Link>
            </Empty>
          )}
        </div>
      </section>
    </>
  )
}

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageMasthead, SectionHead } from '@/components/domain/Sections'
import { ButtonLink, Empty } from '@/components/ui'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import {
  LOADOUT_MODES,
  PRICE_TIERS,
  WEAPON_CATEGORIES,
  type LoadoutMode,
  type PriceTier,
} from '@/lib/delta-loadouts'
import { getAuthContext } from '@/lib/identity/kernel'
import { loadoutFacets } from '@/lib/loadout-facets'
import { listViewerLoadoutMarks } from '@/lib/loadout-community'
import {
  listOwnLoadoutCodes,
  queryLoadoutCodes,
  type LoadoutSort,
  type LoadoutSource,
} from '@/lib/loadout-queries'
import { photoUrl } from '@/lib/media'
import { PLANET_COLORS } from '@/lib/planets'
import { getGame } from '@/lib/queries/public'
import { LoadoutCards } from './LoadoutCards'
import { LoadoutFilters, LoadoutPager, type BrowseState } from './LoadoutFilters'
import { LoadoutLookup } from './LoadoutLookup'
import { HeroBuild, HeroStats } from './LoadoutHero'
import { LoadoutSubmitForm } from './LoadoutSubmitForm'
import styles from './loadouts.module.css'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 24

type Search = Partial<
  Record<
    | 'mode'
    | 'source'
    | 'class'
    | 'weapon'
    | 'price'
    | 'map'
    | 'tag'
    | 'sort'
    | 'page'
    | 'paste'
    | 'saved',
    string
  >
>

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

function text(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed && [...trimmed].length <= 30 ? trimmed : null
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

  const mode = pick(search.mode, Object.keys(LOADOUT_MODES) as LoadoutMode[]) ?? 'operations'
  const source = pick(search.source, ['member', 'official'] as LoadoutSource[])
  const facets = await loadoutFacets(db, game.id, { mode, source })
  const category = pick(search.class, WEAPON_CATEGORIES)
  const weapon = facets.weapons.some(entry => entry.name === search.weapon) ? search.weapon! : null
  const price =
    mode === 'operations' ? pick(search.price, Object.keys(PRICE_TIERS) as PriceTier[]) : null
  const state: BrowseState = {
    mode,
    source,
    class: category,
    weapon,
    price,
    map: text(search.map),
    tag: text(search.tag),
    sort: pick(search.sort, ['hot', 'usage', 'new'] as LoadoutSort[]) ?? 'hot',
    page: Math.max(1, Math.min(200, Number.parseInt(search.page ?? '1', 10) || 1)),
    saved: Boolean(accountId && search.saved === '1'),
  }
  const weapons = weapon
    ? [weapon]
    : category
      ? facets.weapons.filter(entry => entry.category === category).map(entry => entry.name)
      : null
  const filter = {
    mode,
    source,
    weapons,
    price: price ? ([PRICE_TIERS[price][1], PRICE_TIERS[price][2]] as const) : null,
    map: state.map,
    tag: state.tag,
    savedBy: state.saved ? accountId : null,
  }
  const [{ codes, total }, expired, own, marks, heroes, featured] = await Promise.all([
    queryLoadoutCodes(db, game.id, filter, {
      sort: state.sort,
      limit: PAGE_SIZE,
      offset: (state.page - 1) * PAGE_SIZE,
    }),
    queryLoadoutCodes(db, game.id, { mode, source, status: 'expired' }, { sort: 'new', limit: 12 }),
    accountId ? listOwnLoadoutCodes(db, accountId, game.id) : Promise.resolve([]),
    accountId ? listViewerLoadoutMarks(db, accountId) : Promise.resolve(null),
    queryLoadoutCodes(db, game.id, {}, { sort: 'hot', limit: 12 }),
    queryLoadoutCodes(db, game.id, { featured: true }, { sort: 'featured', limit: 3 }),
  ])
  const hero = [...featured.codes, ...heroes.codes].find(code => code.shotKey || code.renderUrl)
  const count = (from: LoadoutSource) =>
    facets.groups
      .filter(group => group.source === from)
      .reduce((sum, group) => sum + group.count, 0)
  const filtered = Boolean(category || weapon || price || state.map || state.tag || state.saved)

  return (
    <>
      <PageMasthead
        code="LOADOUT"
        tone={PLANET_COLORS.get(game.slug)}
        eyebrow={`${game.name} / 改枪码`}
        title="改枪码"
        lede="社员压箱底的方案，加上每天同步的官方精选。复制完整改枪码，到改枪台「方案 → 方案共享」一贴即用。"
        density="compact"
        art={
          hero ? (
            <HeroBuild
              shot={hero.shotKey ? photoUrl(hero.shotKey) : null}
              render={hero.renderUrl}
              weapon={null}
            />
          ) : undefined
        }
      >
        <ButtonLink href="#loadout-browse" variant="primary">
          挑一套方案
        </ButtonLink>
        <ButtonLink href="#loadout-submit">投稿我的改枪码</ButtonLink>
        <ButtonLink href={`/games/${game.slug}/maps`}>战术沙盘</ButtonLink>
        <HeroStats
          items={[
            ['社员方案', count('member')],
            ['官方精选', count('official')],
          ]}
        />
      </PageMasthead>

      <section className={`section ${styles.browse}`} id="loadout-browse">
        <div className="wrap">
          {featured.codes.length && state.page === 1 && !filtered ? (
            <div className={styles.featured}>
              <SectionHead
                eyebrow="CLUB PICKS · 社团精选"
                title="管理员挑过的方案"
                lede="社团内战、日常开黑里反复验证过的配置，先从这几套开始。"
              />
              <LoadoutCards codes={featured.codes} marks={marks} anchored={false} />
            </div>
          ) : null}
          <LoadoutFilters
            slug={game.slug}
            state={state}
            facets={facets}
            total={total}
            signedIn={Boolean(accountId)}
            lookup={<LoadoutLookup slug={game.slug} />}
          />

          {codes.length ? (
            <LoadoutCards codes={codes} marks={marks} />
          ) : (
            <Empty
              action={
                <ButtonLink href="#loadout-submit" variant="primary">
                  投稿一套
                </ButtonLink>
              }
            >
              {filtered
                ? state.saved
                  ? '还没有收藏的方案，看到顺手的点一下书签。'
                  : '这个组合还没人改出来，换个条件，或者你来当第一个枪匠。'
                : `${LOADOUT_MODES[mode]}还是一片空白，第一套方案等你来填。`}
            </Empty>
          )}
          <LoadoutPager slug={game.slug} state={state} pages={Math.ceil(total / PAGE_SIZE)} />

          {expired.codes.length ? (
            <details className={styles.expired}>
              <summary>已失效的方案 · {expired.total}</summary>
              <p>版本更迭后这些码已经导不进去了，配件思路还能参考。</p>
              <LoadoutCards codes={expired.codes} />
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
              <LoadoutSubmitForm
                slug={game.slug}
                initialCode={search.paste?.trim().slice(0, 120) || undefined}
              />
              {own.length ? (
                <div className={styles.own} id="loadout-mine">
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

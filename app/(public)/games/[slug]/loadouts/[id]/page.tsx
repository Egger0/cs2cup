import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PageMasthead, SectionHead } from '@/components/domain/Sections'
import { getCurrentUnifiedPlatformOwner } from '@/lib/auth'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import {
  LOADOUT_MODES,
  channelLabel,
  findWeapon,
  formatCount,
  formatPrice,
  shareString,
} from '@/lib/delta-loadouts'
import { getAuthContext } from '@/lib/identity/kernel'
import { getLoadoutCode, listLoadoutAccessories, queryLoadoutCodes } from '@/lib/loadout-queries'
import { listLoadoutComments, listViewerLoadoutMarks } from '@/lib/loadout-community'
import { PLANET_COLORS } from '@/lib/planets'
import { publicMetadata } from '@/lib/public-metadata'
import { photoUrl } from '@/lib/media'
import { getGame } from '@/lib/queries/public'
import { resolveSiteOrigin } from '@/lib/site-config'
import { ShareButton } from '@/components/share/ShareButton'
import { LoadoutCopyButton } from '../LoadoutCardActions'
import { HeroBuild, HeroStats } from '../LoadoutHero'
import { LoadoutCard, LoadoutCards } from '../LoadoutCards'
import { FeatureToggle } from './FeatureToggle'
import { LoadoutAccessories } from './LoadoutAccessories'
import { LoadoutComments } from './LoadoutComments'
import styles from './detail.module.css'

export const dynamic = 'force-dynamic'

type Params = Promise<{ slug: string; id: string }>

async function load(params: Params) {
  const { slug, id } = await params
  const game = await getGame(slug).catch(() => null)
  const codeId = Number(id)
  if (!game?.loadoutCodes || !Number.isSafeInteger(codeId) || codeId <= 0) return null
  const code = await getLoadoutCode(cloudflareBindings().db, game.id, codeId)
  return code ? { game, code } : null
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const found = await load(params)
  if (!found) return { title: '改枪码', robots: { index: false, follow: false } }
  const { game, code } = found
  const weapon = findWeapon(code.weapon)?.short ?? code.weapon
  return publicMetadata(
    `${code.title} · ${weapon} 改枪码`,
    `${code.authorName} 分享的${LOADOUT_MODES[code.mode]}方案${
      code.price ? `，约 ${formatPrice(code.price)}` : ''
    }。改枪码：${shareString(code.weapon, code.mode, code.code)}`,
    `/games/${game.slug}/loadouts/${code.id}`,
  )
}

export default async function LoadoutDetailPage({ params }: { params: Params }) {
  const found = await load(params)
  if (!found) notFound()
  const { game, code } = found
  const db = cloudflareBindings().db
  const context = await getAuthContext()
  const accountId =
    context.kind === 'authenticated' && !context.session.recoveryRestricted
      ? context.account.id
      : null
  const moderator = accountId
    ? Boolean(await getCurrentUnifiedPlatformOwner().catch(() => null))
    : false
  const [marks, comments, { codes: related }, accessories] = await Promise.all([
    accountId ? listViewerLoadoutMarks(db, accountId) : Promise.resolve(null),
    listLoadoutComments(db, code.id, moderator),
    queryLoadoutCodes(
      db,
      game.id,
      { mode: code.mode, weapons: [code.weapon], excludeId: code.id },
      { limit: 3 },
    ),
    listLoadoutAccessories(db, code.accessories),
  ])
  const weapon = findWeapon(code.weapon)
  const full = shareString(code.weapon, code.mode, code.code)

  return (
    <>
      <PageMasthead
        code={(weapon?.short ?? 'LOADOUT').toUpperCase()}
        tone={PLANET_COLORS.get(game.slug)}
        eyebrow={`${game.name} / 改枪码 / ${LOADOUT_MODES[code.mode]}`}
        title={code.title}
        lede={
          code.source === 'official'
            ? `官方精选 · ${code.authorName}${
                code.authorChannel ? `（${channelLabel(code.authorChannel)}）` : ''
              }的 ${weapon?.short ?? code.weapon} 方案，游戏内已被使用 ${formatCount(code.applyCount)} 次。`
            : `${code.authorName}分享的 ${weapon?.short ?? code.weapon} 方案。复制完整改枪码，到改枪台「方案 → 方案共享」一贴即用。`
        }
        density="compact"
        art={
          code.shotKey || code.renderUrl || weapon?.image ? (
            <HeroBuild
              shot={code.shotKey && photoUrl(code.shotKey)}
              render={code.renderUrl}
              weapon={weapon?.image ?? null}
            />
          ) : undefined
        }
      >
        <span className={styles.heroCopy}>
          <LoadoutCopyButton id={code.id} value={full} title={code.title} hint />
        </span>
        <ShareButton
          className={styles.share}
          share={{
            title: code.title,
            text: `${full}${code.price ? `　约 ${formatPrice(code.price)}` : ''}`,
            url: `${resolveSiteOrigin()}/games/${game.slug}/loadouts/${code.id}`,
            label: '改枪码 / LOADOUT',
          }}
        >
          分享给队友
        </ShareButton>
        {moderator && code.status === 'approved' ? (
          <FeatureToggle id={code.id} featured={Boolean(code.featuredAt)} />
        ) : null}
        <HeroStats
          items={(
            [
              ['游戏内使用', code.applyCount ? formatCount(code.applyCount) : 0],
              ['次复制', code.copies],
              ['人说好用', code.likes],
              ['哈夫币', code.price ? formatPrice(code.price) : 0],
            ] as const
          ).filter(
            ([label, value]) =>
              value !== 0 ||
              (code.source === 'member' && label !== '哈夫币' && label !== '游戏内使用'),
          )}
        />
      </PageMasthead>

      <section className="section">
        <div className={`wrap ${styles.layout}`}>
          <div className={styles.build}>
            <LoadoutCard code={code} marks={marks} single />
            {code.maps.length ? (
              <p className={styles.maps}>适用地图：{code.maps.join(' · ')}</p>
            ) : null}
            <LoadoutAccessories items={accessories} />
          </div>
          <div className={styles.discussion} id="comments">
            <SectionHead
              eyebrow={`${comments.filter(comment => !comment.hidden).length} 条留言`}
              title="交流"
              lede="用下来手感怎么样、换了哪个配件、适合哪张图，都可以聊。"
            />
            <LoadoutComments
              slug={game.slug}
              codeId={code.id}
              comments={comments}
              viewerId={accountId}
              moderator={moderator}
              open={code.status === 'approved' || code.status === 'expired'}
            />
          </div>
        </div>
      </section>

      {related.length ? (
        <>
          <div className="divider" />
          <section className="section">
            <div className="wrap">
              <SectionHead eyebrow={weapon?.short ?? code.weapon} title="同一把枪的其他方案" />
              <LoadoutCards codes={related} marks={marks} />
            </div>
          </section>
        </>
      ) : null}
    </>
  )
}

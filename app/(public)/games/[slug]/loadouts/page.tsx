import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { LoadoutCodeList } from '@/components/domain/LoadoutCodeList'
import { PageMasthead, SectionHead } from '@/components/domain/Sections'
import { ButtonLink, Empty } from '@/components/ui'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { getAuthContext } from '@/lib/identity/kernel'
import { listLoadoutCodes, listOwnLoadoutCodes } from '@/lib/loadout-codes'
import { PLANET_COLORS } from '@/lib/planets'
import { getGame } from '@/lib/queries/public'
import { LoadoutSubmitForm } from './LoadoutSubmitForm'
import styles from './loadouts.module.css'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const game = await getGame((await params).slug).catch(() => null)
  return { title: game ? `${game.name} 改枪码` : '改枪码' }
}

export default async function LoadoutsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const game = await getGame(slug)
  if (!game?.loadoutCodes) notFound()
  const db = cloudflareBindings().db
  const context = await getAuthContext()
  const signedIn = context.kind === 'authenticated' && !context.session.recoveryRestricted
  const [codes, own] = await Promise.all([
    listLoadoutCodes(db, game.id),
    signedIn ? listOwnLoadoutCodes(db, game.id, context.account.id) : Promise.resolve([]),
  ])

  return (
    <>
      <PageMasthead
        code="LOADOUT"
        tone={PLANET_COLORS.get(game.slug)}
        eyebrow={`${game.name} / 改枪码`}
        title="改枪码"
        lede="社员投稿、审核后展示的改装方案。复制改枪码，在游戏的改装界面粘贴即可使用。"
        density="compact"
      >
        <ButtonLink href="#loadout-submit" variant="primary">
          投稿我的改枪码
        </ButtonLink>
        <ButtonLink href={`/games/${game.slug}`}>返回{game.name}</ButtonLink>
      </PageMasthead>

      <section className="section">
        <div className="wrap">
          <SectionHead eyebrow={`${codes.length} 条已审核`} title="大家的改装方案" />
          {codes.length ? (
            <LoadoutCodeList codes={codes} />
          ) : (
            <Empty>还没有通过审核的改枪码，来投第一条吧。</Empty>
          )}
        </div>
      </section>

      <div className="divider" />

      <section className="section" id="loadout-submit">
        <div className={`wrap ${styles.submit}`}>
          <SectionHead
            eyebrow="投稿"
            title="分享你的改枪码"
            lede="每条投稿都会先经过社团审核；同一时间最多 5 条待审核。"
          />
          {signedIn ? (
            <>
              <LoadoutSubmitForm slug={game.slug} />
              {own.length ? (
                <div className={styles.own}>
                  <h3>我的投稿</h3>
                  <LoadoutCodeList codes={own} showStatus />
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

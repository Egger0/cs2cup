import Image from 'next/image'
import { notFound } from 'next/navigation'
import { ButtonLink, Empty } from '@/components/ui'
import { PLANET_COLORS } from '@/lib/planets'
import { PostList } from '@/components/domain/PostList'
import { PageMasthead, SectionHead } from '@/components/domain/Sections'
import { TournamentList } from '@/components/domain/TournamentList'
import { getGame, listPosts, listTournaments, safely } from '@/lib/queries/public'
import styles from './game.module.css'

export const revalidate = 300

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const game = await safely(() => getGame(slug), null)
  return { title: game ? game.name : '项目' }
}

export default async function GamePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const game = await getGame(slug)
  if (!game) notFound()

  const [tournaments, posts] = await Promise.all([
    safely(listTournaments, []),
    safely(() => listPosts(), []),
  ])

  const mine = tournaments.filter(tournament => tournament.gameId === game.id)
  const news = posts.filter(post => post.gameId === game.id)
  return (
    <>
      <PageMasthead
        code={game.slug.toUpperCase()}
        tone={PLANET_COLORS.get(game.slug)}
        eyebrow={game.nameEn ?? game.slug}
        title={<span className={styles.name}>{game.name}</span>}
        lede={game.tagline ?? undefined}
        art={
          PLANET_COLORS.has(game.slug) ? (
            <Image
              className={styles.planet}
              src={`/models/planet-${game.slug}.webp`}
              alt=""
              width={1600}
              height={924}
              priority
              unoptimized
            />
          ) : undefined
        }
      >
        <ButtonLink href="#game-tournaments" variant="primary">
          查看本项目赛事
        </ButtonLink>
        <span className={styles.stats}>
          <span className={styles.stat}>
            <b>{String(mine.length).padStart(2, '0')}</b>
            <span>届赛事</span>
          </span>
          <span className={styles.stat}>
            <b>{String(news.length).padStart(2, '0')}</b>
            <span>条动态</span>
          </span>
        </span>
      </PageMasthead>

      {game.description ? (
        <section className={`section ${styles.overviewSection}`}>
          <div className="wrap">
            <div className={styles.about}>
              <div className={styles.descriptionBlock}>
                <div className={styles.overviewLabel}>PROJECT NOTE · 项目说明</div>
                <p className={styles.description}>{game.description}</p>
              </div>
              {game.formatNote ? (
                <div className={styles.format}>
                  <div className="readout">FORMAT · 社团赛制</div>
                  <p>{game.formatNote}</p>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <div className="divider" />

      <section className="section" id="game-tournaments">
        <div className="wrap">
          <div data-rise>
            <SectionHead eyebrow="赛事" title={`${game.name} 的比赛`} />
          </div>
          {mine.length > 0 ? (
            <TournamentList tournaments={mine} />
          ) : (
            <Empty
              action={
                <ButtonLink href="/about" variant="primary">
                  来牵头办一场
                </ButtonLink>
              }
            >
              这个项目还没有办过比赛。社团有服务器、有裁判、有海报设计，缺的是发起人。
            </Empty>
          )}
        </div>
      </section>

      {news.length > 0 ? (
        <>
          <div className="divider" />
          <section className="section">
            <div className="wrap">
              <div data-rise>
                <SectionHead eyebrow="动态" title={`${game.name} 相关`} />
              </div>
              <PostList posts={news} />
            </div>
          </section>
        </>
      ) : null}
    </>
  )
}

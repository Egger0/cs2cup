import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button, Empty } from '@/components/ui'
import { PostList } from '@/components/domain/PostList'
import { SectionHead } from '@/components/domain/Sections'
import {
  getCurrentTournament,
  getSiteSetting,
  listGames,
  listPosts,
  listTournaments,
  safely,
} from '@/lib/queries/public'
import styles from './home.module.css'

export const revalidate = 300

const FALLBACK = {
  id: 1,
  clubName: '宁波理工电竞社',
  clubNameEn: 'ESPORTS CLUB',
  school: '浙大宁波理工学院',
  logoUrl: null,
  contactQq: null,
  contactWechat: null,
  footerCopy: null,
}

export default async function HomePage() {
  const [setting, games, tournaments, posts, current] = await Promise.all([
    safely(getSiteSetting, FALLBACK),
    safely(listGames, []),
    safely(listTournaments, []),
    safely(() => listPosts(4), []),
    safely(getCurrentTournament, null),
  ])

  if (!setting) notFound()

  const countFor = (gameId: number) =>
    tournaments.filter(tournament => tournament.gameId === gameId).length

  return (
    <>
      <section className={styles.hero}>
        <div className="wrap">
          <div className={styles.crest}>
            <Image
              src={setting.logoUrl ?? '/brand/club-logo.jpg'}
              alt=""
              width={224}
              height={224}
              priority
            />
          </div>
          <h1 className={styles.name}>{setting.clubName}</h1>
          <div className={styles.school}>{setting.school}</div>
          <p className={styles.lede}>
            办比赛,也一起开黑。选手、解说、导播、摄影、设计——每个位置都缺人。
          </p>
          <div className={styles.actions}>
            {current ? (
              <Link href={`/tournaments/${current.slug}`}>
                <Button variant="primary">看本届宁理杯</Button>
              </Link>
            ) : null}
            <Link href="/about">
              <Button>加入我们</Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div data-rise>
            <SectionHead eyebrow="项目" title="我们在玩什么" />
          </div>
          <div className={styles.games}>
            {games.map(game => (
              <Link
                key={game.id}
                href={`/games/${game.slug}`}
                className={styles.game}
                style={{ '--game-accent': game.accentColor ?? undefined } as React.CSSProperties}
              >
                <div className={styles.gameName}>{game.name}</div>
                <div className={styles.gameEn}>{game.nameEn ?? game.slug}</div>
                {game.tagline ? <p className={styles.gameTagline}>{game.tagline}</p> : null}
                <div className={styles.gameMeta}>
                  {countFor(game.id) > 0 ? `${countFor(game.id)} 届赛事` : '筹备中'}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <div className="divider" />

      <section className="section">
        <div className="wrap">
          <div className={styles.columns}>
            <div>
              <div data-rise>
                <SectionHead eyebrow="社团动态" title="最近发生了什么" />
              </div>
              {posts.length > 0 ? <PostList posts={posts} /> : <Empty>还没有发布动态</Empty>}
            </div>

            <aside>
              {current ? (
                <div className={styles.spotlight}>
                  <div className={styles.spotlightHead}>
                    <span className="readout">进行中</span>
                    <span className="readout">{current.season}</span>
                  </div>
                  <div className={styles.spotlightTitle}>{current.title}</div>
                  <div className={styles.spotlightMeta}>
                    {current.gameName ?? ''} · 第 {current.edition} 届
                  </div>
                  <p className={styles.spotlightBody}>{current.lede}</p>
                  <div style={{ marginTop: 20 }}>
                    <Link href={`/tournaments/${current.slug}`}>
                      <Button size="mini">进入赛事页</Button>
                    </Link>
                  </div>
                </div>
              ) : null}
            </aside>
          </div>
        </div>
      </section>
    </>
  )
}

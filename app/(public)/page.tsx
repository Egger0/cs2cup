import Link from 'next/link'
import { notFound } from 'next/navigation'
import { TournamentPulse } from '@/components/domain/TournamentPulse'
import { PostList } from '@/components/domain/PostList'
import { SectionHead } from '@/components/domain/Sections'
import { Button, Empty } from '@/components/ui'
import {
  getCurrentTournament,
  getRegistrationStatus,
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
  const registration = current
    ? await safely(() => getRegistrationStatus(current.slug), { cap: current.teamCap, taken: 0, open: false })
    : null

  if (!setting) notFound()

  const countFor = (gameId: number) =>
    tournaments.filter(tournament => tournament.gameId === gameId).length
  const remainingSeats = current && registration ? Math.max(registration.cap - registration.taken, 0) : 0

  return (
    <>
      <section className={styles.hero}>
        <span className={styles.radar} aria-hidden />
        <div className={`wrap ${styles.heroGrid}`}>
          <div className={styles.heroCopy}>
            <div className={styles.eyebrow}>
              <span />
              {current ? `CURRENT TOURNAMENT · ${current.season}` : setting.clubNameEn ?? 'ESPORTS CLUB'}
            </div>
            {current ? (
              <>
                <div className={styles.edition}>C{current.edition}</div>
                <h1 className={styles.title}>{current.title}</h1>
                <p className={styles.lede}>{current.lede}</p>
                <div className={styles.meta}>
                  <span>{current.gameName ?? '赛事项目'}</span>
                  <span>{current.format || '赛制待定'}</span>
                  <span>{registration?.open ? `报名剩余 ${remainingSeats} 席` : '报名状态更新中'}</span>
                </div>
                <div className={styles.actions}>
                  <Link href={`/tournaments/${current.slug}`}><Button variant="primary">查看赛事</Button></Link>
                  {registration?.open ? (
                    <Link href={`/tournaments/${current.slug}/register`}><Button>报名参赛</Button></Link>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <h1 className={styles.title}>{setting.clubName}</h1>
                <p className={styles.lede}>办比赛，也一起开黑。选手、解说、导播、摄影、设计——每个位置都缺人。</p>
                <div className={styles.actions}>
                  <Link href="/tournaments"><Button variant="primary">查看赛事</Button></Link>
                  <Link href="/about"><Button>加入我们</Button></Link>
                </div>
              </>
            )}
          </div>

          {current && registration ? (
            <TournamentPulse
              status={current.status}
              startsAt={current.startsAt}
              teamCap={registration.cap}
              taken={registration.taken}
              registrationOpen={registration.open}
            />
          ) : null}
        </div>
      </section>

      {current && registration ? (
        <section className={styles.telemetry} aria-label="赛事概览">
          <div className={`wrap ${styles.telemetryGrid}`}>
            <div><span>赛事届次</span><b>第 {current.edition} 届</b></div>
            <div><span>参赛项目</span><b>{current.gameName ?? '待定'}</b></div>
            <div><span>当前状态</span><b>{current.status === 'postponed' ? '延期中' : registration.open ? '报名开放' : '报名关闭'}</b></div>
            <div><span>战队席位</span><b>{registration.taken} / {registration.cap}</b></div>
          </div>
        </section>
      ) : null}

      <section className="section">
        <div className="wrap">
          <div data-rise><SectionHead eyebrow="项目档案" title="我们在玩什么" /></div>
          <div className={styles.games}>
            {games.map(game => (
              <Link
                key={game.id}
                href={`/games/${game.slug}`}
                className={styles.game}
                style={{ '--game-accent': game.accentColor ?? undefined } as React.CSSProperties}
              >
                <div className={styles.gameTop}><span>GAME_{String(game.id).padStart(2, '0')}</span><span>→</span></div>
                <div className={styles.gameName}>{game.name}</div>
                <div className={styles.gameEn}>{game.nameEn ?? game.slug}</div>
                {game.tagline ? <p className={styles.gameTagline}>{game.tagline}</p> : null}
                <div className={styles.gameMeta}>{countFor(game.id) > 0 ? `${countFor(game.id)} 届赛事记录` : '筹备中'}</div>
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
              <div data-rise><SectionHead eyebrow="社团动态" title="最近发生了什么" /></div>
              {posts.length > 0 ? <PostList posts={posts} /> : <Empty>还没有发布动态</Empty>}
            </div>

            <aside className={styles.clubCard}>
              <span className={styles.clubLabel}>CLUB SIGNAL</span>
              <h2>{setting.clubName}</h2>
              <p>{setting.school}</p>
              <Link href="/about"><Button size="mini">认识社团</Button></Link>
            </aside>
          </div>
        </div>
      </section>
    </>
  )
}

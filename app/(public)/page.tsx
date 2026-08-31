import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { NextMatchCountdown } from '@/components/domain/NextMatchCountdown'
import { ButtonLink, Empty } from '@/components/ui'
import { PostList } from '@/components/domain/PostList'
import { SectionHead } from '@/components/domain/Sections'
import { buildScheduleEntries, selectNextScheduleEntry } from '@/lib/schedule'
import {
  getCurrentTournament,
  getMatches,
  getPublicTeams,
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
  const previewCountdown = process.env.HOME_PREVIEW_COUNTDOWN === '1'
  const [setting, games, tournaments, posts, current] = await Promise.all([
    safely(getSiteSetting, FALLBACK),
    safely(listGames, []),
    safely(listTournaments, []),
    safely(() => listPosts(4), []),
    safely(getCurrentTournament, null),
  ])

  if (!setting) notFound()

  let nextMatch: ReturnType<typeof selectNextScheduleEntry> = null
  if (current) {
    const [teams, matches] = await Promise.all([
      safely(() => getPublicTeams(current.id), []),
      safely(() => getMatches(current.id), []),
    ])
    nextMatch = selectNextScheduleEntry(buildScheduleEntries(matches, teams))
  }

  const countFor = (gameId: number) =>
    tournaments.filter(tournament => tournament.gameId === gameId).length

  return (
    <>
      <section className={styles.hero}>
        <div className={`wrap ${styles.heroGrid}`}>
          <div className={styles.heroCopy}>
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
              办比赛，也一起开黑。选手、解说、导播、摄影、设计——每个位置都缺人。
            </p>
            <div className={styles.actions}>
              {current ? (
                <ButtonLink href={`/tournaments/${current.slug}`} variant="primary">
                  看本届宁理杯
                </ButtonLink>
              ) : null}
              <ButtonLink href="/about">加入我们</ButtonLink>
            </div>
          </div>
          {current || previewCountdown ? (
            <div className={styles.heroPanel}>
              <NextMatchCountdown
                tournamentTitle={current?.title ?? '本地预览'}
                scheduleHref={current ? `/tournaments/${current.slug}/schedule` : undefined}
                match={
                  nextMatch && current
                    ? {
                        href: `/tournaments/${current.slug}/matches/${nextMatch.match.id}`,
                        scheduledAt: nextMatch.match.scheduledAt,
                        roundLabel: nextMatch.match.roundLabel,
                        bestOf: nextMatch.match.bestOf,
                        teamA: nextMatch.a?.tag ?? '待定',
                        teamB: nextMatch.b?.tag ?? '待定',
                        status: nextMatch.status,
                      }
                    : null
                }
              />
            </div>
          ) : null}
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
                data-game={game.slug}
              >
                <div className={styles.gameName}>{game.name}</div>
                <div className={styles.gameEn}>{game.nameEn ?? game.slug}</div>
                {game.tagline ? <p className={styles.gameTagline}>{game.tagline}</p> : null}
                <div className={styles.gameMeta}>
                  <span className={styles.gameStatusDot} aria-hidden="true" />
                  <span className={styles.gameMetaText}>
                    {countFor(game.id) > 0 ? (
                      <>
                        已举办 <strong>{String(countFor(game.id)).padStart(2, '0')}</strong> 届赛事
                      </>
                    ) : (
                      '赛季筹备中'
                    )}
                  </span>
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
                    <ButtonLink href={`/tournaments/${current.slug}`} size="mini">
                      进入赛事页
                    </ButtonLink>
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

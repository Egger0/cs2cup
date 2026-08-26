import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button, Empty } from '@/components/ui'
import { PostList } from '@/components/domain/PostList'
import { ResultsTable } from '@/components/domain/ResultsTable'
import { SectionHead } from '@/components/domain/Sections'
import { SeatGrid } from '@/components/domain/SeatGrid'
import { Versus } from '@/components/domain/Versus'
import { indexTeams, nextPlayableMatch } from '@/lib/bracket'
import {
  getMatchMaps,
  getMatches,
  getPublicTeams,
  getTournament,
  listPosts,
  listTournaments,
  safely,
} from '@/lib/queries/public'
import type { TournamentStatus } from '@/lib/types'
import styles from './page.module.css'

export const revalidate = 300
export const dynamicParams = true

const STATUS_TEXT: Record<TournamentStatus, string> = {
  draft: '筹备中',
  registration: '报名开放中',
  running: '正在进行',
  finished: '已结束',
  postponed: '延期中',
}

export async function generateStaticParams() {
  const tournaments = await safely(listTournaments, [])
  return tournaments.map(tournament => ({ slug: tournament.slug }))
}

export default async function OverviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const tournament = await getTournament(slug)
  if (!tournament) notFound()

  const [teams, matches, posts] = await Promise.all([
    getPublicTeams(tournament.id),
    getMatches(tournament.id),
    safely(() => listPosts(2), []),
  ])

  const next = nextPlayableMatch(matches, indexTeams(teams))
  const recent = matches.filter(match => match.winnerTeamId !== null).slice(-4)
  const matchMaps = await safely(() => getMatchMaps(recent.map(match => match.id)), [])

  return (
    <section className="section">
      <div className="wrap">
        <div className={styles.overview}>
          <div className={styles.main}>
            <div data-rise>
              <p className={styles.lede}>{tournament.lede}</p>
            </div>

            <div data-rise="2">
              <div className={styles.block}>
                <SectionHead eyebrow="下一场" title={next ? '即将开打' : '等待抽签'} />
                {next ? (
                  <Link href={`/tournaments/${slug}/matches/${next.match.id}`}>
                    <Versus match={next.match} a={next.a} b={next.b} />
                  </Link>
                ) : (
                  <Empty>报名满员后统一抽签,首轮对阵会出现在这里</Empty>
                )}
              </div>
            </div>

            <div data-rise="2">
              <div className={styles.block}>
                <SectionHead eyebrow="最近战报" title="打完的比赛" />
                <ResultsTable
                  matches={matches}
                  teams={teams}
                  maps={matchMaps}
                  slug={tournament.slug}
                  limit={4}
                />
                <p className={styles.more}>
                  <Link href={`/tournaments/${slug}/results`} className="readout">
                    查看全部战报 →
                  </Link>
                </p>
              </div>
            </div>

            {posts.length > 0 ? (
              <div data-rise="3">
                <div className={styles.block}>
                  <SectionHead eyebrow="公告" title="最近发生了什么" />
                  <PostList posts={posts} />
                </div>
              </div>
            ) : null}
          </div>

          <aside className={styles.aside}>
            <SeatGrid
              teams={teams}
              capacity={tournament.teamCap}
              statusLabel={STATUS_TEXT[tournament.status]}
            />

            <div className={styles.cta}>
              <p>带上你的五人车,来抢下这座校园杯。</p>
              <Link href={`/tournaments/${slug}/register`}>
                <Button variant="primary">报名参赛</Button>
              </Link>
            </div>

            {tournament.mapPool.length > 0 ? (
              <div className={styles.pool}>
                <div className="readout">现役地图池</div>
                <ul className={styles.poolList}>
                  {tournament.mapPool.map(map => (
                    <li key={map}>{map}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </aside>
        </div>
      </div>
    </section>
  )
}

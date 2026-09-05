import Link from 'next/link'
import { notFound } from 'next/navigation'
import { TournamentEntryPanel } from '@/components/domain/TournamentEntryPanel'
import { PostList } from '@/components/domain/PostList'
import { ResultsTable } from '@/components/domain/ResultsTable'
import { SectionHead } from '@/components/domain/Sections'
import { isCompletedMatch } from '@/lib/bracket'
import {
  getMatchMaps,
  getMatches,
  getPublicTeams,
  getRegistrationStatus,
  getTournament,
  listPosts,
  safely,
} from '@/lib/queries/public'
import styles from './page.module.css'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return { alternates: { canonical: `/tournaments/${encodeURIComponent(slug)}` } }
}

export default async function OverviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const tournament = await getTournament(slug)
  if (!tournament) notFound()
  const [teams, matches, posts, registration] = await Promise.all([
    getPublicTeams(tournament.id),
    getMatches(tournament.id),
    safely(() => listPosts(2), []),
    safely(() => getRegistrationStatus(slug), null),
  ])
  const recent = matches.filter(isCompletedMatch).slice(-5)
  const matchMaps = await safely(() => getMatchMaps(recent.map(match => match.id)), [])
  const base = `/tournaments/${slug}`
  return (
    <section className="section">
      <div className="wrap">
        <div className={styles.overview}>
          <aside className={styles.aside}>
            <TournamentEntryPanel tournament={tournament} registration={registration} />
          </aside>
          <div className={styles.main}>
            {recent.length ? (
              <section>
                <SectionHead
                  eyebrow="MATCH REPORTS"
                  title="最近战报"
                  lede="比分、选图与晋级结果，在这里跟进。"
                />
                <ResultsTable
                  matches={matches}
                  teams={teams}
                  maps={matchMaps}
                  slug={slug}
                  limit={5}
                />
                <p className={styles.more}>
                  <Link href={`${base}/results`}>查看全部战报 →</Link>
                </p>
              </section>
            ) : null}
            <section
              className={recent.length ? styles.block : undefined}
              aria-labelledby="overview-teams-title"
            >
              <div className={styles.teamHeading}>
                <h2 id="overview-teams-title">参赛战队</h2>
                <Link href={`${base}/teams`}>查看全部 {teams.length} 支战队 →</Link>
              </div>
              {teams.length ? (
                <div className={styles.teamList}>
                  {teams.slice(0, 8).map(team => (
                    <Link key={team.id} href={`${base}/teams/${encodeURIComponent(team.tag)}`}>
                      <strong>{team.tag}</strong>
                      <span>{team.name}</span>
                      <span aria-hidden="true">↗</span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className={styles.note}>等待第一支战队加入。审核通过的队伍会展示在这里。</p>
              )}
              {!recent.length ? (
                <p className={styles.note}>
                  战报将在比赛结束后更新。<Link href={`${base}/schedule`}>先查看比赛日程 →</Link>
                </p>
              ) : null}
            </section>
            {posts.length ? (
              <section className={styles.block}>
                <SectionHead eyebrow="CLUB JOURNAL" title="社团动态" />
                <PostList posts={posts} />
              </section>
            ) : null}
          </div>
          {tournament.mapPool.length ? (
            <details className={styles.pool}>
              <summary>本届地图池 · {tournament.mapPool.length} 张地图</summary>
              <ul className={styles.poolList}>
                {tournament.mapPool.map(map => (
                  <li key={map}>{map}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </div>
    </section>
  )
}

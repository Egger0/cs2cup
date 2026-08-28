import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui'
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

export const revalidate = 300
export const dynamicParams = true

export default async function OverviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const tournament = await getTournament(slug)
  if (!tournament) notFound()

  const [teams, matches, posts, registration] = await Promise.all([
    getPublicTeams(tournament.id),
    getMatches(tournament.id),
    safely(() => listPosts(2), []),
    safely(() => getRegistrationStatus(slug), { cap: tournament.teamCap, taken: 0, open: false }),
  ])

  const recent = matches.filter(isCompletedMatch).slice(-5)
  const matchMaps = await safely(() => getMatchMaps(recent.map(match => match.id)), [])
  const seatsLeft = Math.max(0, registration.cap - registration.taken)
  const acceptingEntries = registration.open && seatsLeft > 0

  return (
    <section className="section">
      <div className="wrap">
        <div className={styles.overview}>
          <div className={styles.main}>
            <div data-rise>
              <SectionHead eyebrow="最近战报" title="打完的比赛" />
              <ResultsTable
                matches={matches}
                teams={teams}
                maps={matchMaps}
                slug={tournament.slug}
                limit={5}
              />
              <p className={styles.more}>
                <Link href={`/tournaments/${slug}/results`} className="readout">
                  查看全部战报 →
                </Link>
              </p>
            </div>

            {posts.length > 0 ? (
              <div data-rise="2" className={styles.block}>
                <SectionHead eyebrow="公告" title="最近发生了什么" />
                <PostList posts={posts} />
              </div>
            ) : null}
          </div>

          <aside className={styles.aside}>
            <div className={styles.cta}>
              <div className="readout">{acceptingEntries ? '报名开放中' : '报名已截止'}</div>
              <p className={styles.ctaLine}>
                {acceptingEntries
                  ? `还剩 ${seatsLeft} 个席位,先到先得。`
                  : registration.open
                    ? '十六个席位已满,下一届见。'
                    : '本届不再接受报名。'}
              </p>
              {acceptingEntries ? (
                <Link href={`/tournaments/${slug}/register`}>
                  <Button variant="primary">报名参赛</Button>
                </Link>
              ) : (
                <Link href={`/tournaments/${slug}/teams`}>
                  <Button>看看谁报了名</Button>
                </Link>
              )}
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

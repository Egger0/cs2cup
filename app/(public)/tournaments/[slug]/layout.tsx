import { notFound } from 'next/navigation'
import { PhotoBackdrop } from '@/components/domain/PhotoBackdrop'
import { TournamentTabs } from '@/components/layout/TournamentTabs'
import { getMatches, getPhotos, getPublicTeams, getTournament, safely } from '@/lib/queries/public'
import type { TournamentStatus } from '@/lib/types'
import styles from '@/components/layout/TournamentShell.module.css'

const STATUS_TEXT: Record<TournamentStatus, string> = {
  draft: '筹备中',
  registration: '报名开放中',
  running: '正在进行',
  finished: '已结束',
  postponed: '延期中',
}

export default async function TournamentLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const tournament = await getTournament(slug)
  if (!tournament) notFound()

  const [teams, matches, photos] = await Promise.all([
    getPublicTeams(tournament.id),
    getMatches(tournament.id),
    safely(() => getPhotos(tournament.id), []),
  ])

  const played = matches.filter(match => match.winnerTeamId !== null).length
  const base = `/tournaments/${slug}`

  return (
    <>
      <header className={styles.shell}>
        <PhotoBackdrop photo={photos[0] ?? null} />
        <div className={`wrap ${styles.inner}`}>
          <div className={styles.top}>
            <div className={styles.identity}>
              <span className={styles.status}>
                <span className={styles.dot} aria-hidden />
                {tournament.heroEyebrow || STATUS_TEXT[tournament.status]}
              </span>

              <h1 className={styles.title}>
                <span className={styles.latin}>{tournament.heroTop}</span>
                <span className={styles.cjk}>{tournament.heroBottom}</span>
              </h1>

              <div className={styles.meta}>
                第 {tournament.edition} 届 · {tournament.season} · {tournament.game.toUpperCase()}
              </div>
            </div>

            <div className={styles.quick}>
              <div className={styles.quickCell}>
                <div className={styles.quickValue}>
                  {teams.length}
                  <span style={{ color: 'var(--muted-2)' }}>/{tournament.teamCap}</span>
                </div>
                <div className={styles.quickKey}>席位</div>
              </div>
              <div className={styles.quickCell}>
                <div className={styles.quickValue}>
                  {played}
                  <span style={{ color: 'var(--muted-2)' }}>/{matches.length}</span>
                </div>
                <div className={styles.quickKey}>已完赛</div>
              </div>
              <div className={styles.quickCell}>
                <div className={styles.quickValue}>{tournament.mapPool.length}</div>
                <div className={styles.quickKey}>地图池</div>
              </div>
            </div>
          </div>

          <TournamentTabs
            tabs={[
              { href: base, label: '总览', exact: true },
              { href: `${base}/teams`, label: '参赛战队', count: teams.length },
              { href: `${base}/bracket`, label: '对阵表' },
              { href: `${base}/results`, label: '战报', count: played },
              { href: `${base}/rules`, label: '赛制与须知' },
            ]}
          />
        </div>
      </header>
      {children}
    </>
  )
}

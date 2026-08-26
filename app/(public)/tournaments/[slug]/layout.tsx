import { notFound } from 'next/navigation'
import { TournamentTabs } from '@/components/layout/TournamentTabs'
import Link from 'next/link'
import { indexTeams, nextPlayableMatch } from '@/lib/bracket'
import { getMatches, getPublicTeams, getTournament } from '@/lib/queries/public'
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

  const [teams, matches] = await Promise.all([
    getPublicTeams(tournament.id),
    getMatches(tournament.id),
  ])

  const played = matches.filter(match => match.winnerTeamId !== null).length
  const next = nextPlayableMatch(matches, indexTeams(teams))
  const base = `/tournaments/${slug}`

  return (
    <>
      <header className={styles.shell}>
        <span className={styles.glow} aria-hidden />
        <span className={styles.grain} aria-hidden />
        <div className={`wrap ${styles.inner}`}>
          <div className={styles.split}>
          <div>
          <span className={styles.status}>
            <span className={styles.dot} aria-hidden />
            {tournament.heroEyebrow || STATUS_TEXT[tournament.status]}
          </span>

          <h1 className={styles.title}>
            <span className={styles.cjk}>{tournament.heroBottom}</span>
            <span className={styles.latin}>
              {tournament.game.toUpperCase()} · 第 {tournament.edition} 届 · {tournament.season}
            </span>
          </h1>

          <p className={styles.tagline}>十六支车队,一张图定生死,输一场就回家。</p>

          <div className={styles.rail}>
            <span className={styles.railItem}>
              <span className={styles.railValue}>
                {teams.length}
                <span className={styles.railTotal}>/{tournament.teamCap}</span>
              </span>
              <span className={styles.railKey}>席位</span>
            </span>
            <span className={styles.railItem}>
              <span className={styles.railValue}>
                {played}
                <span className={styles.railTotal}>/{matches.length}</span>
              </span>
              <span className={styles.railKey}>已完赛</span>
            </span>
            <span className={styles.railItem}>
              <span className={styles.railValue}>{tournament.mapPool.length}</span>
              <span className={styles.railKey}>现役地图</span>
            </span>
          </div>
          </div>

          {next ? (
            <Link href={`${base}/matches/${next.match.id}`} className={styles.card}>
              <div className={styles.cardHead}>
                <span>下一场</span>
                <span>{next.match.roundLabel}</span>
              </div>
              <div className={styles.cardSide}>
                <span className={styles.cardTag}>{next.a?.tag ?? 'TBD'}</span>
                <span className={styles.cardName}>{next.a?.name ?? '待定'}</span>
              </div>
              <div className={styles.cardVs}>VS</div>
              <div className={styles.cardSide}>
                <span className={styles.cardTag}>{next.b?.tag ?? 'TBD'}</span>
                <span className={styles.cardName}>{next.b?.name ?? '待定'}</span>
              </div>
              <div className={styles.cardFoot}>
                <span>BO{next.match.bestOf}</span>
                <span>
                  {next.match.scheduledAt
                    ? new Date(next.match.scheduledAt).toLocaleString('zh-CN', {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '时间待定'}
                </span>
              </div>
            </Link>
          ) : null}
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

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { formatSiteCompactDateTime } from '@/lib/datetime'
import { FollowTournament } from '@/components/discovery/FollowTournament'
import { ShareButton } from '@/components/share/ShareButton'
import { Icon } from '@/components/ui/Icon'
import type { PublicShare } from '@/lib/share-poster'
import { TournamentTabs, type TournamentTab } from './TournamentTabs'
import styles from './TournamentHeader.module.css'
import matchStyles from './TournamentMatchCard.module.css'

interface NextMatchSummary {
  id: number
  roundLabel: string
  bestOf: number
  scheduledAt: string | null
  aTag: string
  aName: string
  bTag: string
  bName: string
  status: string
}

interface TournamentHeaderProps {
  base: string
  status: string
  eyebrow: string
  title: string
  game: string
  edition: number
  season: string
  tagline: string
  seats: [number, number]
  played: [number, number]
  deadline: string | null
  primaryAction: { href: string; label: string }
  next: NextMatchSummary | null
  tabs: TournamentTab[]
  tournamentId: number
  share: PublicShare
}

export function TournamentHeader({
  base,
  status,
  eyebrow,
  title,
  game,
  edition,
  season,
  tagline,
  seats,
  played,
  deadline,
  primaryAction,
  next,
  tabs,
  tournamentId,
  share,
}: TournamentHeaderProps) {
  const pathname = usePathname()
  const compact = pathname !== base
  const tools = (
    <>
      <FollowTournament id={tournamentId} title={share.title} />
      <ShareButton share={share}>分享赛事</ShareButton>
      <a href={`${base}/calendar.ics`} download>
        <Icon name="calendar" size={16} />
        加入日历
      </a>
    </>
  )

  return (
    <>
      <header className={compact ? `${styles.shell} ${styles.compact}` : styles.shell}>
        <span className={styles.glow} aria-hidden />

        <div className={`wrap ${styles.inner}`}>
          <div className={styles.split}>
            <div>
              <span className={styles.status}>
                <span className={styles.dot} aria-hidden />
                {eyebrow || status}
              </span>

              <h1 className={styles.title}>
                <Link href={base} className={styles.cjk}>
                  {title}
                </Link>
                <span className={styles.latin}>
                  {game.toUpperCase()} · 第 {edition} 届 · {season}
                </span>
              </h1>

              {compact ? null : <p className={styles.tagline}>{tagline}</p>}

              <div className={styles.controls}>
                <Link href={primaryAction.href} className={styles.primary}>
                  {primaryAction.label} <Icon name="arrow" size={16} />
                </Link>
                {compact ? (
                  <details className={styles.tools}>
                    <summary>更多赛事工具</summary>
                    <div className={styles.toolGroup}>{tools}</div>
                  </details>
                ) : (
                  tools
                )}
              </div>

              {compact ? null : (
                <div className={styles.rail}>
                  <span className={styles.railItem}>
                    <span className={styles.railValue}>
                      {seats[0]}
                      <span className={styles.railTotal}>/{seats[1]}</span>
                    </span>
                    <span className={styles.railKey}>已报名 · 含待审核</span>
                  </span>
                  <span className={styles.railItem}>
                    <span className={styles.railValue}>
                      {played[0]}
                      <span className={styles.railTotal}>/{played[1]}</span>
                    </span>
                    <span className={styles.railKey}>已完赛</span>
                  </span>
                  <span className={styles.railItem}>
                    <span className={styles.deadline}>{deadline ?? '暂未公布'}</span>
                    <span className={styles.railKey}>报名截止 · 北京时间</span>
                  </span>
                </div>
              )}
            </div>

            {next && !compact ? (
              <div className={matchStyles.nextBlock}>
                <Link href={`${base}/matches/${next.id}`} className={matchStyles.card}>
                  <div className={matchStyles.cardHead}>
                    <span>
                      {next.status === 'overdue'
                        ? '等待赛果'
                        : next.status === 'waiting'
                          ? '等待对阵'
                          : '下一场'}
                    </span>
                    <span>{next.roundLabel}</span>
                  </div>
                  <div className={matchStyles.cardSide}>
                    <span className={matchStyles.cardTag}>{next.aTag}</span>
                    <span className={matchStyles.cardName}>{next.aName}</span>
                  </div>
                  <div className={matchStyles.cardVs}>VS</div>
                  <div className={matchStyles.cardSide}>
                    <span className={matchStyles.cardTag}>{next.bTag}</span>
                    <span className={matchStyles.cardName}>{next.bName}</span>
                  </div>
                  <div className={matchStyles.cardFoot}>
                    <span>BO{next.bestOf}</span>
                    {next.scheduledAt ? (
                      <time dateTime={next.scheduledAt}>
                        {formatSiteCompactDateTime(next.scheduledAt) ?? '时间待定'}
                      </time>
                    ) : (
                      <span>时间待定</span>
                    )}
                  </div>
                </Link>
                <Link href={`${base}/schedule`} className={matchStyles.scheduleLink}>
                  查看全部赛程 →
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      </header>
      <TournamentTabs tabs={tabs} />
    </>
  )
}

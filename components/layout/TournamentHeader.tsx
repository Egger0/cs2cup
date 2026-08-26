'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { TournamentTabs, type TournamentTab } from './TournamentTabs'
import styles from './TournamentShell.module.css'

export interface NextMatchSummary {
  id: number
  roundLabel: string
  bestOf: number
  scheduledAt: string | null
  aTag: string
  aName: string
  bTag: string
  bName: string
}

export interface TournamentHeaderProps {
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
  maps: number
  next: NextMatchSummary | null
  tabs: TournamentTab[]
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
  maps,
  next,
  tabs,
}: TournamentHeaderProps) {
  const pathname = usePathname()
  const compact = pathname !== base

  return (
    <header className={compact ? `${styles.shell} ${styles.compact}` : styles.shell}>
      <span className={styles.glow} aria-hidden />
      <span className={styles.grain} aria-hidden />

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

            <p className={styles.tagline}>{tagline}</p>

            <div className={styles.rail}>
              <span className={styles.railItem}>
                <span className={styles.railValue}>
                  {seats[0]}
                  <span className={styles.railTotal}>/{seats[1]}</span>
                </span>
                <span className={styles.railKey}>席位</span>
              </span>
              <span className={styles.railItem}>
                <span className={styles.railValue}>
                  {played[0]}
                  <span className={styles.railTotal}>/{played[1]}</span>
                </span>
                <span className={styles.railKey}>已完赛</span>
              </span>
              <span className={styles.railItem}>
                <span className={styles.railValue}>{maps}</span>
                <span className={styles.railKey}>现役地图</span>
              </span>
            </div>
          </div>

          {next ? (
            <Link href={`${base}/matches/${next.id}`} className={styles.card}>
              <div className={styles.cardHead}>
                <span>下一场</span>
                <span>{next.roundLabel}</span>
              </div>
              <div className={styles.cardSide}>
                <span className={styles.cardTag}>{next.aTag}</span>
                <span className={styles.cardName}>{next.aName}</span>
              </div>
              <div className={styles.cardVs}>VS</div>
              <div className={styles.cardSide}>
                <span className={styles.cardTag}>{next.bTag}</span>
                <span className={styles.cardName}>{next.bName}</span>
              </div>
              <div className={styles.cardFoot}>
                <span>BO{next.bestOf}</span>
                <span>
                  {next.scheduledAt
                    ? new Date(next.scheduledAt).toLocaleString('zh-CN', {
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

        <TournamentTabs tabs={tabs} />
      </div>
    </header>
  )
}

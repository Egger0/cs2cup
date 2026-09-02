import Link from 'next/link'
import type { HomeTournamentSignal } from '@/lib/home-tournament-signal'
import { HomeBracket } from './HomeBracket'
import styles from './HomeHero.module.css'
import signalStyles from './HomeSignal.module.css'

export function HomeHero({ signal }: { signal: HomeTournamentSignal | null }) {
  const href = signal ? `/tournaments/${signal.slug}` : '/tournaments'
  const label = signal
    ? `查看当前赛事：${signal.title}，${signal.season}，第 ${signal.edition} 届，${signal.statusLabel}`
    : '查看全部赛事'
  const fileLabel = signal
    ? `CURRENT FILE / ${signal.season}—${String(signal.edition).padStart(2, '0')}`
    : 'ALL FILES / 2022—'

  return (
    <section
      className={styles.cover}
      aria-labelledby="home-title"
      data-home-cover
      data-header-tone="dark"
    >
      <div className={styles.canvas}>
        <div className={styles.meta}>
          <span>浙大宁波理工学院</span>
          <span>2022—</span>
        </div>

        <HomeBracket />

        <div className={styles.titleBlock}>
          <p>NINGLI ESPORTS CLUB</p>
          <h1 id="home-title" aria-label="宁理电竞社">
            <span>宁理</span>
            <span>电竞社</span>
          </h1>
        </div>

        <div className={styles.finalLabel} aria-hidden="true">
          <span>FINAL</span>
          <strong>01</strong>
        </div>

        <a href="#route" className={styles.scrollCue} aria-label="继续浏览赛事路径">
          <span>SCROLL</span>
          <strong>02</strong>
          <i aria-hidden="true" />
        </a>

        <Link href={href} className={signalStyles.signal} aria-label={label} data-home-signal>
          <span className={signalStyles.signalMeta} aria-hidden="true">
            <span>{fileLabel}</span>
            <span>{signal?.statusLabel ?? '赛事目录'}</span>
          </span>
          <span className={signalStyles.signalTitle}>
            <strong>{signal?.title ?? '进入赛事'}</strong>
            <span aria-hidden="true">→</span>
          </span>
        </Link>
      </div>
    </section>
  )
}

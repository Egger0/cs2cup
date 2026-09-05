import Link from 'next/link'
import type { HomeTournamentSignal } from '@/lib/home-tournament-signal'
import { Icon } from '@/components/ui/Icon'
import { HomeBracket } from './HomeBracket'
import { HomeMotionControl } from './HomeMotionControl'
import styles from './HomeHero.module.css'
import signalStyles from './HomeSignal.module.css'

export function HomeHero({ signal }: { signal: HomeTournamentSignal | null }) {
  const base = signal ? `/tournaments/${signal.slug}` : '/tournaments'
  return (
    <section
      className={styles.cover}
      aria-labelledby="home-title"
      data-home-cover
      data-header-tone="dark"
    >
      <div className={styles.canvas} data-layout-container>
        <div className={styles.art}>
          <HomeBracket />
        </div>
        <div className={styles.topline}>
          <p className={styles.meta}>
            <span className={styles.coordinate} aria-hidden="true">
              01 / HOME COURT
            </span>
            浙大宁波理工学院
          </p>
          <HomeMotionControl />
        </div>
        <div className={styles.main}>
          <div className={styles.copy}>
            <p className={styles.eyebrow}>NINGLI ESPORTS CLUB / EST. 2022</p>
            <h1 id="home-title" aria-label="宁理电竞社">
              <span>宁理</span>
              <span>
                电竞社
                <span className={styles.titlePoint} aria-hidden="true" />
              </span>
            </h1>
            <p className={styles.tagline}>在宁理，为热爱上场。</p>
            <div className={styles.links}>
              <Link href="/tournaments">
                浏览全部赛事 <Icon name="arrow" size={16} />
              </Link>
              <Link href="/about#join">
                加入电竞社 <Icon name="diagonal" size={16} />
              </Link>
            </div>
          </div>
        </div>
        <div className={styles.dock}>
          <a href="#clubhouse" className={styles.scrollCue}>
            <span aria-hidden="true">↓</span>
            <span>
              探索我们的主场<small>PLAY. CONNECT. BELONG.</small>
            </span>
          </a>
          <aside className={signalStyles.signal} aria-label="当前赛事入口">
            <div className={signalStyles.details}>
              <div className={signalStyles.signalMeta}>
                <span>当前赛事 / {signal?.season ?? 'NEXT UP'}</span>
                <span className={signalStyles.status}>{signal?.statusLabel ?? '敬请期待'}</span>
              </div>
              <Link
                href={base}
                className={signalStyles.signalTitle}
                data-home-signal
                aria-label={
                  signal
                    ? `查看当前赛事：${signal.title}，${signal.season}，第 ${signal.edition} 届，${signal.statusLabel}`
                    : '查看全部赛事'
                }
              >
                {signal?.title ?? '下一场，等你一起'} <Icon name="diagonal" size={16} />
              </Link>
            </div>
            <Link
              className={signalStyles.primary}
              href={
                signal
                  ? `${base}/${signal.status === 'registration' ? 'register' : 'schedule'}`
                  : '/tournaments'
              }
            >
              {signal?.status === 'registration'
                ? '组队报名'
                : signal
                  ? '查看赛程'
                  : '进入赛事大厅'}
              <Icon name="arrow" />
            </Link>
          </aside>
        </div>
      </div>
    </section>
  )
}

import Link from 'next/link'
import type { HomeTournamentSignal } from '@/lib/home-tournament-signal'
import { Icon } from '@/components/ui/Icon'
import { HomeBracket } from './HomeBracket'
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
      <div className={styles.canvas}>
        <div className={styles.art}>
          <HomeBracket />
        </div>
        <div className={styles.copy}>
          <p className={styles.meta}>浙大宁波理工学院 · NINGLI ESPORTS CLUB</p>
          <h1 id="home-title">
            宁理<span>电竞社</span>
          </h1>
          <p className={styles.tagline}>在宁理，为热爱上场。</p>
          <p className={styles.lede}>
            找到你的比赛，也找到并肩的队友。
            <br />
            赛事报名、赛程战报和社团近况，都在这里。
          </p>
          <div className={styles.actions}>
            <Link href="/tournaments">
              浏览全部赛事 <Icon name="arrow" />
            </Link>
            <Link href="/about#join">
              加入电竞社 <Icon name="diagonal" size={16} />
            </Link>
          </div>
        </div>
        <aside className={signalStyles.signal} aria-label="当前赛事入口">
          <div className={signalStyles.signalMeta}>
            <span>当前赛事</span>
            <span>{signal?.statusLabel ?? '敬请期待'}</span>
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
            {signal?.title ?? '下一场，等你一起'} <Icon name="diagonal" />
          </Link>
          <p>
            {signal
              ? `${signal.season} 赛季 · 第 ${signal.edition} 届`
              : '关注赛事大厅，获取最新比赛安排。'}
          </p>
          <div className={signalStyles.actions}>
            <Link
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
                  : '进入赛事大厅'}{' '}
              <Icon name="arrow" />
            </Link>
            {signal ? <Link href={base}>赛事详情</Link> : null}
          </div>
          <p className={signalStyles.note}>
            {signal?.status === 'registration'
              ? '报名资格、名额与截止时间以赛事页为准。'
              : '对局时间与最新安排以赛程页为准。'}
          </p>
        </aside>
      </div>
    </section>
  )
}

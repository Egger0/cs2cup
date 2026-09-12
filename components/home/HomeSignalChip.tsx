'use client'

import Link from 'next/link'
import type { HomeTournamentSignal } from '@/lib/home-tournament-signal'
import { Icon } from '@/components/ui/Icon'
import styles from './HomeSignalChip.module.css'

const highlight = (key: string | null) =>
  window.dispatchEvent(new CustomEvent('solar:hover', { detail: key }))

export function HomeSignalChip({
  signal,
  current,
}: {
  signal: HomeTournamentSignal | null
  current: string | null
}) {
  const base = signal ? `/tournaments/${signal.slug}` : '/tournaments'
  return (
    <aside
      className={styles.signal}
      aria-label="当前赛事入口"
      data-status={signal?.status ?? 'none'}
      data-solar-reserve
      onMouseEnter={() => highlight(current)}
      onMouseLeave={() => highlight(null)}
      onFocus={() => highlight(current)}
      onBlur={() => highlight(null)}
    >
      <p className={styles.signalMeta}>
        <i className={styles.beacon} aria-hidden="true" />
        当前赛事 / {signal?.season ?? 'NEXT UP'}
        <span className={styles.state}>{signal?.statusLabel ?? '敬请期待'}</span>
      </p>
      <Link
        href={base}
        className={styles.signalTitle}
        data-home-signal
        aria-label={
          signal
            ? `查看当前赛事：${signal.title}，${signal.season}，第 ${signal.edition} 届，${signal.statusLabel}`
            : '查看全部赛事'
        }
      >
        {signal?.title ?? '下一场，等你一起'} <Icon name="diagonal" size={16} />
      </Link>
      <Link
        className={styles.signalAction}
        href={
          signal
            ? `${base}/${signal.status === 'registration' ? 'register' : 'schedule'}`
            : '/tournaments'
        }
      >
        {signal?.status === 'registration' ? '组队报名' : signal ? '查看赛程' : '进入赛事大厅'}
        <Icon name="arrow" size={16} />
      </Link>
    </aside>
  )
}

'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { formatSiteDateTime } from '@/lib/datetime'
import type { ScheduleStatus } from '@/lib/schedule'
import styles from './NextMatchCountdown.module.css'

type MatchSummary = {
  href: string
  scheduledAt: string | null
  roundLabel: string
  bestOf: number
  teamA: string
  teamB: string
  status: ScheduleStatus
}

type NextMatchCountdownProps = {
  tournamentTitle: string
  match: MatchSummary | null
  scheduleHref?: string
}

function formatRemaining(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60

  return [days, hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':')
}

export function NextMatchCountdown({ tournamentTitle, match, scheduleHref }: NextMatchCountdownProps) {
  const [now, setNow] = useState<number | null>(null)
  const scheduledAt = match?.scheduledAt ? new Date(match.scheduledAt).getTime() : null
  const isScheduled = scheduledAt !== null && !Number.isNaN(scheduledAt)

  useEffect(() => {
    if (scheduledAt === null || Number.isNaN(scheduledAt)) return

    const initial = window.setTimeout(() => setNow(Date.now()), 0)
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [scheduledAt])

  const countdown = useMemo(
    () => (isScheduled && scheduledAt && now !== null ? formatRemaining(scheduledAt - now) : '— — : — — : — — : — —'),
    [isScheduled, now, scheduledAt],
  )
  const hasStarted =
    scheduledAt !== null && isScheduled && now !== null && scheduledAt <= now
  const isWaiting = match?.status === 'waiting'

  const panel = match ? (
    <Link href={match.href} className={styles.match}>
      <span className={styles.matchLabel}>
        {isWaiting ? '等待对阵' : hasStarted ? '待更新场次' : '下一场'}
      </span>
      <strong>{match.teamA} <span>VS</span> {match.teamB}</strong>
      <span className={styles.matchMeta}>
        {match.roundLabel} · BO{match.bestOf} ·{' '}
        {isScheduled ? (
          <time dateTime={match.scheduledAt!}>
            {formatSiteDateTime(match.scheduledAt!) ?? '时间待定'}
          </time>
        ) : (
          '时间待定'
        )}
      </span>
    </Link>
  ) : (
    <div className={styles.match}>
      <span className={styles.matchLabel}>{tournamentTitle}</span>
      <strong>赛程仍在编排</strong>
      <span className={styles.matchMeta}>对阵公布后将在这里显示</span>
    </div>
  )

  return (
    <aside className={styles.card} aria-label="下一场比赛">
      <div className={styles.topline} />
      <div className={styles.head}>
        <span>
          {isWaiting
            ? '对阵尚未确定'
            : hasStarted
              ? '比赛已到开赛时间'
              : isScheduled
                ? '距离下一场开赛'
                : '下一场比赛'}
        </span>
        <span className={styles.status}>
          <i /> {isWaiting ? '等待晋级结果' : hasStarted ? '等待赛果' : isScheduled ? '赛程已定' : '等待排期'}
        </span>
      </div>
      {isScheduled && !hasStarted ? (
        <time className={styles.countdown} dateTime={match?.scheduledAt ?? undefined}>{countdown}</time>
      ) : (
        <p className={styles.pending}>
          {isWaiting ? '等待对阵确定' : hasStarted ? '等待赛果更新' : '下一场时间待定'}
        </p>
      )}
      {panel}
      {scheduleHref ? (
        <Link href={scheduleHref} className={styles.scheduleLink}>
          查看全部赛程 →
        </Link>
      ) : null}
    </aside>
  )
}

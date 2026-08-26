'use client'

import { useSyncExternalStore } from 'react'
import { Badge } from '@/components/ui'
import { readClock, readServerClock, subscribeToClock } from '@/lib/clock'
import type { TournamentStatus } from '@/lib/types'
import styles from './Countdown.module.css'

export interface CountdownProps {
  status: TournamentStatus
  scheduledAt: string | null
  label: string
  opponents: string
}

const STATUS_NOTICE: Partial<Record<TournamentStatus, string>> = {
  postponed: '赛事延期中',
  draft: '赛事筹备中',
  finished: '赛事已结束',
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function remaining(target: number, now: number) {
  const delta = Math.max(0, target - now)
  const totalSeconds = Math.floor(delta / 1000)
  return {
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  }
}

export function Countdown({ status, scheduledAt, label, opponents }: CountdownProps) {
  const target = scheduledAt ? Date.parse(scheduledAt) : null
  const now = useSyncExternalStore(subscribeToClock, readClock, readServerClock)

  const notice = STATUS_NOTICE[status]
  const showClock = notice === undefined && target !== null && Number.isFinite(target)

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <span>{showClock ? '距下一场开赛' : '赛事状态'}</span>
        <Badge tone="alert" dot>
          {label}
        </Badge>
      </div>

      {showClock ? (
        <div className={styles.clock} suppressHydrationWarning>
          {now === 0
            ? '--:--:--'
            : (() => {
                const { hours, minutes, seconds } = remaining(target, now)
                return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
              })()}
        </div>
      ) : (
        <p className={styles.notice}>{notice ?? '开赛时间待定'}</p>
      )}

      <div className={styles.match}>
        下一场:<b>{opponents}</b>
      </div>
    </div>
  )
}

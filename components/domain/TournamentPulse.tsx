'use client'

import { useEffect, useState } from 'react'
import type { TournamentStatus } from '@/lib/types'
import styles from './TournamentPulse.module.css'

interface TournamentPulseProps {
  status: TournamentStatus
  startsAt: string | null
  teamCap: number
  taken: number
  registrationOpen: boolean
}

function remainingTime(startsAt: string, now: number) {
  const distance = new Date(startsAt).getTime() - now
  if (distance <= 0) return null

  const days = Math.floor(distance / 86_400_000)
  const hours = Math.floor((distance % 86_400_000) / 3_600_000)
  const minutes = Math.floor((distance % 3_600_000) / 60_000)
  const seconds = Math.floor((distance % 60_000) / 1_000)
  return { days, hours, minutes, seconds }
}

const STATUS_LABEL: Record<TournamentStatus, string> = {
  draft: '筹备中',
  registration: '报名开放',
  running: '赛事进行中',
  postponed: '延期中',
  finished: '赛事结束',
}

export function TournamentPulse({
  status,
  startsAt,
  teamCap,
  taken,
  registrationOpen,
}: TournamentPulseProps) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (status === 'postponed' || !startsAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [startsAt, status])

  const countdown = status === 'postponed' || !startsAt ? null : remainingTime(startsAt, now)

  const remaining = Math.max(teamCap - taken, 0)
  const stateText = registrationOpen ? '报名开放' : teamCap > 0 && remaining === 0 ? '报名已满' : '报名关闭'

  return (
    <section className={styles.panel} aria-label="赛事状态">
      <div className={styles.topline}>
        <span className={styles.signal} aria-hidden />
        <span>TOURNAMENT CONTROL</span>
        <span className={status === 'postponed' ? styles.warning : styles.status}>{STATUS_LABEL[status]}</span>
      </div>

      {countdown ? (
        <div className={styles.countdown} aria-live="polite">
          <span><b>{String(countdown.days).padStart(2, '0')}</b>天</span>
          <span><b>{String(countdown.hours).padStart(2, '0')}</b>时</span>
          <span><b>{String(countdown.minutes).padStart(2, '0')}</b>分</span>
          <span><b>{String(countdown.seconds).padStart(2, '0')}</b>秒</span>
        </div>
      ) : (
        <div className={styles.primaryState}>
          {status === 'postponed' ? '延期中' : stateText}
        </div>
      )}

      <div className={styles.readings}>
        <div><span>已提交</span><b>{taken}</b></div>
        <div><span>总席位</span><b>{teamCap}</b></div>
        <div><span>剩余</span><b>{remaining}</b></div>
      </div>
      <p className={styles.note}>
        {countdown ? '距离正式开赛' : status === 'postponed' ? `赛事时间待定 · ${stateText}` : stateText}
      </p>
    </section>
  )
}

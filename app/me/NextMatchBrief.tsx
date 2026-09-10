'use client'

import { useEffect, useMemo, useState } from 'react'
import { formatSiteDateTime } from '@/lib/datetime'
import type { ParticipantNextMatch } from '@/lib/queries/participant-next-match'
import styles from './next-match-brief.module.css'

type EmptyReason = 'review' | 'standby'

const UNIT_LABELS = ['日', '时', '分', '秒'] as const

function remainingParts(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000))
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  return [days, hours, minutes, seconds].map(value => String(value).padStart(2, '0'))
}

function TeamSlot({
  team,
  ownedTeamId,
}: {
  team: ParticipantNextMatch['match']['teamA']
  ownedTeamId: number
}) {
  const owned = team?.id === ownedTeamId
  return (
    <div className={styles.team} data-owned={owned || undefined}>
      <span>{owned ? 'MY ENTRY / 我方' : team ? 'OPPONENT / 对手' : 'OPPONENT / PENDING'}</span>
      <strong>
        <small>[{team?.tag ?? 'TBD'}]</small>
        {team?.name ?? '等待席位确认'}
      </strong>
    </div>
  )
}

function EmptyBrief({ reason }: { reason: EmptyReason }) {
  return (
    <section className={`${styles.brief} ${styles.empty}`} aria-labelledby="next-brief-title">
      <header className={styles.header}>
        <p>NEXT DISPATCH / 作战简报 01</p>
        <span>STANDBY / 待命</span>
      </header>
      <div className={styles.emptyBody}>
        <span className={styles.emptyCode} aria-hidden="true">
          — —
        </span>
        <div>
          <h2 id="next-brief-title">{reason === 'review' ? '等待报名审核' : '简报尚未签发'}</h2>
          <p>
            {reason === 'review'
              ? '审核通过且公开对阵发布后，下一场比赛会自动出现在这里。'
              : '目前没有可执行的待进行对局；赛程或赛事状态变更时，此处会同步更新。'}
          </p>
        </div>
      </div>
    </section>
  )
}

export function NextMatchBrief({
  nextMatch,
  emptyReason = 'standby',
  initialNow,
}: {
  nextMatch: ParticipantNextMatch | null
  emptyReason?: EmptyReason
  initialNow: number
}) {
  const [now, setNow] = useState(initialNow)
  const scheduledTime = useMemo(() => {
    if (!nextMatch?.match.scheduledAt || nextMatch.match.status === 'unscheduled') return null
    const value = new Date(nextMatch.match.scheduledAt).getTime()
    return Number.isFinite(value) ? value : null
  }, [nextMatch])

  useEffect(() => {
    if (scheduledTime === null || scheduledTime <= initialNow) return
    const startedAt = window.performance.now()
    const navigation = window.performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined
    const responseStart = navigation?.responseStart ?? startedAt
    const mountedNow = Math.min(scheduledTime, initialNow + Math.max(0, startedAt - responseStart))
    const initialTimer = window.setTimeout(() => setNow(mountedNow), 0)
    if (mountedNow >= scheduledTime) return () => window.clearTimeout(initialTimer)
    const timer = window.setInterval(() => {
      const current = Math.min(scheduledTime, mountedNow + window.performance.now() - startedAt)
      setNow(current)
      if (current >= scheduledTime) window.clearInterval(timer)
    }, 1_000)
    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(timer)
    }
  }, [initialNow, scheduledTime])

  if (!nextMatch) return <EmptyBrief reason={emptyReason} />

  const hasStarted =
    nextMatch.match.status === 'overdue' || (scheduledTime !== null && scheduledTime <= now)
  const waiting = nextMatch.match.status === 'waiting'
  const countdown = scheduledTime !== null ? remainingParts(scheduledTime - now) : null
  const stateLabel = waiting
    ? '等待晋级结果'
    : hasStarted
      ? '等待赛果更新'
      : scheduledTime === null
        ? '等待排期'
        : '赛程已签发'
  const clockLabel = waiting
    ? '对手席位待确认'
    : hasStarted
      ? '已到开赛时间'
      : scheduledTime === null
        ? '时间尚待签发'
        : '距离下一场开赛'
  const absoluteTime = nextMatch.match.scheduledAt
    ? formatSiteDateTime(nextMatch.match.scheduledAt)
    : null
  const matchHref = `/tournaments/${encodeURIComponent(nextMatch.tournament.slug)}/matches/${nextMatch.match.id}`

  return (
    <section className={styles.brief} aria-labelledby="next-brief-title">
      <header className={styles.header}>
        <h2 id="next-brief-title">NEXT DISPATCH / 作战简报 01</h2>
        <span data-state={nextMatch.match.status}>
          <i aria-hidden="true" /> {stateLabel}
        </span>
      </header>

      <div className={styles.body}>
        <div className={styles.clock}>
          <p>{clockLabel}</p>
          {!hasStarted && scheduledTime !== null ? (
            <time dateTime={nextMatch.match.scheduledAt ?? undefined}>
              {(countdown ?? ['--', '--', '--', '--']).map((value, index) => (
                <span key={UNIT_LABELS[index]}>
                  <strong>{value}</strong>
                  <small>{UNIT_LABELS[index]}</small>
                </span>
              ))}
            </time>
          ) : (
            <strong className={styles.pending}>
              {waiting ? 'SEAT PENDING' : hasStarted ? 'RESULT PENDING' : 'TIME PENDING'}
            </strong>
          )}
          <small>
            {absoluteTime ? (
              <time dateTime={nextMatch.match.scheduledAt ?? undefined}>{absoluteTime}</time>
            ) : (
              '北京时间 · 待赛事方排期'
            )}
          </small>
        </div>

        <div className={styles.fixture}>
          <TeamSlot team={nextMatch.match.teamA} ownedTeamId={nextMatch.ownedTeam.id} />
          <b aria-hidden="true">VS</b>
          <TeamSlot team={nextMatch.match.teamB} ownedTeamId={nextMatch.ownedTeam.id} />
        </div>
      </div>

      <footer className={styles.footer}>
        <p>
          <strong>{nextMatch.tournament.title}</strong>
          <span>
            {nextMatch.match.roundLabel} · BO{nextMatch.match.bestOf}
          </span>
        </p>
        <a href={matchHref}>
          查看对局详情 <span aria-hidden="true">↗</span>
        </a>
      </footer>
    </section>
  )
}

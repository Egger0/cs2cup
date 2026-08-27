'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { Button, Field } from '@/components/ui'
import { indexMatches, indexTeams, isByeMatch, resolveMatch } from '@/lib/bracket'
import { dateTimeLocalToIso, isoToDateTimeLocal } from '@/lib/datetime'
import type { Match, PublicTeam } from '@/lib/types'
import { publishMatchSchedule } from '../../_actions'
import styles from '../../admin.module.css'

type Feedback = { tone: 'ok' | 'error' | 'info'; message: string }
type Draft = Record<number, string>

const DAY_MS = 86_400_000
const MINUTE_MS = 60_000
const MAX_ROUND_GAP_DAYS = 365
const MAX_MATCH_GAP_MINUTES = 1_440

function initialDraft(matches: readonly Match[]): Draft {
  return Object.fromEntries(
    matches.map(match => [match.id, isoToDateTimeLocal(match.scheduledAt ?? '') ?? '']),
  )
}

export function Scheduler({
  tournamentId,
  matches,
  teams,
}: {
  tournamentId: number
  matches: Match[]
  teams: PublicTeam[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [draft, setDraft] = useState<Draft>(() => initialDraft(matches))
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  const schedulable = matches.filter(match => !isByeMatch(match))
  const original = initialDraft(schedulable)
  const dirty = schedulable.some(match => (draft[match.id] ?? '') !== original[match.id])
  const matchIndex = indexMatches(matches)
  const teamIndex = indexTeams(teams)
  const rounds = [...new Set(schedulable.map(match => match.round))].sort((a, b) => a - b)

  useEffect(() => {
    if (!dirty) return

    const message = '尚有未发布的赛程更改，离开将丢失这些内容。'
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = message
    }
    const confirmNavigation = (event: globalThis.MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) return

      const target = event.target
      const link = target instanceof Element ? target.closest('a[href]') : null
      if (!(link instanceof HTMLAnchorElement) || link.target || link.download) return

      const destination = new URL(link.href, window.location.href)
      if (destination.href === window.location.href) return
      if (!window.confirm(message)) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }

    window.addEventListener('beforeunload', preventUnload)
    document.addEventListener('click', confirmNavigation, true)
    return () => {
      window.removeEventListener('beforeunload', preventUnload)
      document.removeEventListener('click', confirmNavigation, true)
    }
  }, [dirty])

  function sourceName(sourceId: number | null) {
    if (sourceId === null) return { tag: 'TBD', name: '待定' }
    const source = matchIndex.get(sourceId)
    return source
      ? { tag: 'TBD', name: `${source.roundLabel} #${source.slot + 1} 胜者` }
      : { tag: 'TBD', name: '待定' }
  }

  function preview(form: HTMLFormElement) {
    const data = new FormData(form)
    const start = dateTimeLocalToIso(String(data.get('start') ?? ''))
    const roundGapDays = Number(data.get('roundGap'))
    const matchGapMinutes = Number(data.get('matchGap'))

    if (!start) {
      setFeedback({ tone: 'error', message: '请填写有效的北京时间' })
      return
    }
    if (
      !Number.isSafeInteger(roundGapDays) ||
      roundGapDays < 0 ||
      roundGapDays > MAX_ROUND_GAP_DAYS
    ) {
      setFeedback({ tone: 'error', message: `每轮间隔必须是 0–${MAX_ROUND_GAP_DAYS} 天的整数` })
      return
    }
    if (
      !Number.isSafeInteger(matchGapMinutes) ||
      matchGapMinutes < 0 ||
      matchGapMinutes > MAX_MATCH_GAP_MINUTES
    ) {
      setFeedback({
        tone: 'error',
        message: `场次间隔必须是 0–${MAX_MATCH_GAP_MINUTES} 分钟的整数`,
      })
      return
    }
    if (dirty && !window.confirm('生成新预览会覆盖当前未发布更改，确定继续吗？')) return

    const startTime = Date.parse(start)
    const roundSlots = new Map<number, number>()
    const next: Draft = {}
    for (const match of schedulable) {
      const roundSlot = roundSlots.get(match.round) ?? 0
      const timestamp =
        startTime + match.round * roundGapDays * DAY_MS + roundSlot * matchGapMinutes * MINUTE_MS
      next[match.id] = isoToDateTimeLocal(timestamp) ?? ''
      roundSlots.set(match.round, roundSlot + 1)
    }
    setDraft(next)
    setFeedback({ tone: 'info', message: '预览已生成，确认无误后再发布' })
  }

  function schedulePayload() {
    const desired = new Map<number, string | null>()
    for (const match of schedulable) {
      const local = (draft[match.id] ?? '').trim()
      const scheduledAt = local === original[match.id]
        ? match.scheduledAt
        : local
          ? dateTimeLocalToIso(local)
          : null
      if (local && !scheduledAt) return { ok: false as const, error: '赛程中存在无效时间' }
      desired.set(match.id, scheduledAt)
    }

    for (const match of schedulable) {
      const childTime = desired.get(match.id)
      if (!childTime) continue
      for (const sourceId of [match.sourceMatchAId, match.sourceMatchBId]) {
        if (sourceId === null) continue
        const sourceTime = desired.get(sourceId)
        if (sourceTime && Date.parse(childTime) <= Date.parse(sourceTime)) {
          return {
            ok: false as const,
            error: `${match.roundLabel} #${match.slot + 1} 必须晚于来源比赛`,
          }
        }
      }
    }

    return {
      ok: true as const,
      rows: schedulable.map(match => ({
        id: match.id,
        expectedScheduledAt: match.scheduledAt,
        scheduledAt: desired.get(match.id) ?? null,
      })),
    }
  }

  function publish() {
    const payload = schedulePayload()
    if (!payload.ok) {
      setFeedback({ tone: 'error', message: payload.error })
      return
    }

    const overwrites = schedulable.some(
      match => match.scheduledAt !== null && (draft[match.id] ?? '') !== original[match.id],
    )
    if (overwrites && !window.confirm('这会覆盖已发布的比赛时间，确定继续吗？')) return

    setFeedback(null)
    startTransition(async () => {
      const result = await publishMatchSchedule(tournamentId, JSON.stringify(payload.rows))
      if (!result.ok) {
        setFeedback({ tone: 'error', message: result.error ?? '发布赛程失败' })
        return
      }
      setFeedback({
        tone: 'ok',
        message: `已发布 ${result.matches} 场，${result.scheduled} 场已有时间`,
      })
      router.refresh()
    })
  }

  return (
    <div className={styles.scheduleEditor}>
      <form
        className={styles.schedulePlanner}
        onSubmit={event => {
          event.preventDefault()
          preview(event.currentTarget)
        }}
      >
        <div className={styles.scheduleFields}>
          <Field
            id="sc-start"
            name="start"
            type="datetime-local"
            label="首场开赛（北京时间）"
            required
          />
          <Field
            id="sc-round"
            name="roundGap"
            type="number"
            min={0}
            max={MAX_ROUND_GAP_DAYS}
            label="每轮间隔（天）"
            defaultValue={7}
          />
          <Field
            id="sc-match"
            name="matchGap"
            type="number"
            min={0}
            max={MAX_MATCH_GAP_MINUTES}
            label="同轮场次间隔（分钟）"
            defaultValue={100}
          />
        </div>
        <div className={styles.rowActions}>
          <Button type="submit" disabled={pending}>生成预览</Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              if (dirty && !window.confirm('清空会覆盖当前未发布更改，确定继续吗？')) return
              setDraft(Object.fromEntries(schedulable.map(match => [match.id, ''])))
              setFeedback({ tone: 'info', message: '时间已在预览中清空，发布后生效' })
            }}
          >
            清空时间
          </Button>
          <Button
            type="button"
            disabled={pending || !dirty}
            onClick={() => {
              setDraft(original)
              setFeedback(null)
            }}
          >
            撤销更改
          </Button>
        </div>
        <p className={styles.scheduleHint}>修改只保存在当前预览中，不会自动写入公开赛程。</p>
      </form>

      <div className={styles.scheduleRounds}>
        {rounds.map(round => (
          <section key={round} className={styles.scheduleRound}>
            <div className={styles.scheduleRoundHead}>
              <span>{schedulable.find(match => match.round === round)?.roundLabel}</span>
              <span>{schedulable.filter(match => match.round === round).length} 场</span>
            </div>
            <div className={styles.timeGrid}>
              {schedulable
                .filter(match => match.round === round)
                .map(match => {
                  const resolved = resolveMatch(match, matchIndex, teamIndex)
                  const a = resolved.a ?? sourceName(match.sourceMatchAId)
                  const b = resolved.b ?? sourceName(match.sourceMatchBId)
                  const changed = (draft[match.id] ?? '') !== original[match.id]

                  return (
                    <label
                      key={match.id}
                      className={styles.timeCell}
                      data-changed={changed || undefined}
                    >
                      <span className={styles.timeSlot}>
                        #{String(match.slot + 1).padStart(2, '0')} · BO{match.bestOf}
                      </span>
                      <span className={styles.timeTeams}>
                        <span><b>{a.tag}</b><small>{a.name}</small></span>
                        <i>VS</i>
                        <span><b>{b.tag}</b><small>{b.name}</small></span>
                      </span>
                      <span className={styles.timeControl}>
                        <span className={styles.timeZone}>北京时间</span>
                        <input
                          type="datetime-local"
                          value={draft[match.id] ?? ''}
                          className={styles.timeInput}
                          disabled={pending}
                          aria-label={`${match.roundLabel} 第 ${match.slot + 1} 场开赛时间`}
                          onChange={event => {
                            setDraft(current => ({ ...current, [match.id]: event.target.value }))
                            setFeedback(null)
                          }}
                        />
                      </span>
                    </label>
                  )
                })}
            </div>
          </section>
        ))}
      </div>

      <div className={styles.schedulePublish} data-dirty={dirty || undefined}>
        <div aria-live="polite">
          <strong>{dirty ? '有未发布更改' : '公开赛程已同步'}</strong>
          {feedback ? (
            <p data-tone={feedback.tone} role={feedback.tone === 'error' ? 'alert' : 'status'}>
              {feedback.message}
            </p>
          ) : null}
        </div>
        <Button type="button" variant="primary" disabled={pending || !dirty} onClick={publish}>
          {pending ? '发布中…' : '发布赛程'}
        </Button>
      </div>
    </div>
  )
}

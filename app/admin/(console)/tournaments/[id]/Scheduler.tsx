'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button, Field } from '@/components/ui'
import { isByeMatch } from '@/lib/bracket'
import type { Match, PublicTeam } from '@/lib/types'
import { publishMatchSchedule } from '../../actions/matches'
import styles from '../../scheduler.module.css'
import {
  buildSchedulePayload,
  emptyScheduleDraft,
  generateSchedulePreview,
  hasPublishedScheduleOverwrite,
  initialScheduleDraft,
  isScheduleDraftDirty,
  MAX_MATCH_GAP_MINUTES,
  MAX_ROUND_GAP_DAYS,
} from './scheduler-model'
import { ScheduleRounds } from './ScheduleRounds'
import { useUnsavedScheduleWarning } from './useUnsavedScheduleWarning'

type Feedback = { tone: 'ok' | 'error' | 'info'; message: string }

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
  const [draft, setDraft] = useState(() => initialScheduleDraft(matches))
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  const schedulable = matches.filter(match => !isByeMatch(match))
  const original = initialScheduleDraft(schedulable)
  const dirty = isScheduleDraftDirty(schedulable, draft, original)

  useUnsavedScheduleWarning(dirty)

  function preview(form: HTMLFormElement) {
    const data = new FormData(form)
    const result = generateSchedulePreview(schedulable, {
      start: String(data.get('start') ?? ''),
      roundGap: String(data.get('roundGap') ?? ''),
      matchGap: String(data.get('matchGap') ?? ''),
    })

    if (!result.ok) {
      setFeedback({ tone: 'error', message: result.error })
      return
    }
    if (dirty && !window.confirm('生成新预览会覆盖当前未发布更改，确定继续吗？')) return

    setDraft(result.draft)
    setFeedback({ tone: 'info', message: '预览已生成，确认无误后再发布' })
  }

  function publish() {
    const payload = buildSchedulePayload(schedulable, draft, original)
    if (!payload.ok) {
      setFeedback({ tone: 'error', message: payload.error })
      return
    }

    if (
      hasPublishedScheduleOverwrite(schedulable, draft, original) &&
      !window.confirm('这会覆盖已发布的比赛时间，确定继续吗？')
    ) {
      return
    }

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
          <Button type="submit" disabled={pending}>
            生成预览
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              if (dirty && !window.confirm('清空会覆盖当前未发布更改，确定继续吗？')) return
              setDraft(emptyScheduleDraft(schedulable))
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

      <ScheduleRounds
        matches={matches}
        schedulable={schedulable}
        teams={teams}
        draft={draft}
        original={original}
        pending={pending}
        onDraftChange={(matchId, value) => {
          setDraft(current => ({ ...current, [matchId]: value }))
          setFeedback(null)
        }}
      />

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

'use client'

import { useState, useTransition } from 'react'
import { Button, Field } from '@/components/ui'
import { isByeMatch } from '@/lib/bracket'
import type { Match } from '@/lib/types'
import { scheduleRounds, setMatchTime } from '../../_actions'
import styles from '../../admin.module.css'

function toLocalInput(iso: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function Scheduler({
  tournamentId,
  matches,
}: {
  tournamentId: number
  matches: Match[]
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')

  const schedulable = matches.filter(match => !isByeMatch(match))
  const rounds = [...new Set(schedulable.map(match => match.round))].sort((a, b) => a - b)

  return (
    <>
      <form
        className={styles.editor}
        style={{ marginBottom: 30 }}
        action={formData =>
          startTransition(async () => {
            const result = await scheduleRounds(
              tournamentId,
              String(formData.get('start') ?? ''),
              Number(formData.get('roundGap')),
              Number(formData.get('matchGap')),
            )
            setMessage(result.ok ? `已排 ${result.scheduled} 场` : (result.error ?? '失败'))
          })
        }
      >
        <div className={styles.pair}>
          <Field id="sc-start" name="start" type="datetime-local" label="首场开赛" required />
          <Field
            id="sc-round"
            name="roundGap"
            type="number"
            min={0}
            label="每轮间隔(天)"
            defaultValue={7}
          />
        </div>
        <Field
          id="sc-match"
          name="matchGap"
          type="number"
          min={0}
          label="同轮相邻场次间隔(分钟)"
          defaultValue={100}
        />
        <div className={styles.rowActions}>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? '排程中…' : '批量排程'}
          </Button>
          {message ? <span className={styles.ok}>{message}</span> : null}
        </div>
      </form>

      {rounds.map(round => (
        <div key={round} style={{ marginBottom: 24 }}>
          <div className="readout" style={{ marginBottom: 10 }}>
            {schedulable.find(match => match.round === round)?.roundLabel}
          </div>
          <div className={styles.timeGrid}>
            {schedulable
              .filter(match => match.round === round)
              .map(match => (
                <label key={match.id} className={styles.timeCell}>
                  <span className={styles.timeSlot}>#{match.slot + 1}</span>
                  <input
                    type="datetime-local"
                    defaultValue={toLocalInput(match.scheduledAt)}
                    className={styles.timeInput}
                    onChange={event =>
                      startTransition(() =>
                        void setMatchTime(match.id, tournamentId, event.target.value),
                      )
                    }
                  />
                </label>
              ))}
          </div>
        </div>
      ))}
    </>
  )
}

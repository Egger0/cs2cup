'use client'

import { indexMatches, indexTeams, resolveMatch } from '@/lib/bracket'
import type { Match, PublicTeam } from '@/lib/types'
import styles from '../../scheduler.module.css'
import type { ScheduleDraft } from './scheduler-model'

function sourceName(sourceId: number | null, matchIndex: Map<number, Match>) {
  if (sourceId === null) return { tag: 'TBD', name: '待定' }
  const source = matchIndex.get(sourceId)
  return source
    ? { tag: 'TBD', name: `${source.roundLabel} #${source.slot + 1} 胜者` }
    : { tag: 'TBD', name: '待定' }
}

export function ScheduleRounds({
  matches,
  schedulable,
  teams,
  draft,
  original,
  pending,
  onDraftChange,
}: {
  matches: Match[]
  schedulable: Match[]
  teams: PublicTeam[]
  draft: ScheduleDraft
  original: ScheduleDraft
  pending: boolean
  onDraftChange: (matchId: number, value: string) => void
}) {
  const matchIndex = indexMatches(matches)
  const teamIndex = indexTeams(teams)
  const rounds = [...new Set(schedulable.map(match => match.round))].sort((a, b) => a - b)

  return (
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
                const a = resolved.a ?? sourceName(match.sourceMatchAId, matchIndex)
                const b = resolved.b ?? sourceName(match.sourceMatchBId, matchIndex)
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
                      <span>
                        <b>{a.tag}</b>
                        <small>{a.name}</small>
                      </span>
                      <i>VS</i>
                      <span>
                        <b>{b.tag}</b>
                        <small>{b.name}</small>
                      </span>
                    </span>
                    <span className={styles.timeControl}>
                      <span className={styles.timeZone}>北京时间</span>
                      <input
                        type="datetime-local"
                        value={draft[match.id] ?? ''}
                        className={styles.timeInput}
                        disabled={pending}
                        aria-label={`${match.roundLabel} 第 ${match.slot + 1} 场开赛时间`}
                        onChange={event => onDraftChange(match.id, event.target.value)}
                      />
                    </span>
                  </label>
                )
              })}
          </div>
        </section>
      ))}
    </div>
  )
}

'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Empty } from '@/components/ui'
import { groupByRound, indexMatches, indexTeams, resolveMatch, winsNeeded } from '@/lib/bracket'
import { confirmScoreWrite } from '@/lib/score-confirmation'
import type { Match, PublicTeam } from '@/lib/types'
import { recordScore } from './actions/matches'
import styles from './scheduler.module.css'

export function ScheduleEditor({
  matches,
  teams,
  tournamentId,
}: {
  matches: Match[]
  teams: PublicTeam[]
  tournamentId: number
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  if (matches.length === 0) return <Empty>还没有生成对阵表</Empty>

  const matchIndex = indexMatches(matches)
  const teamIndex = indexTeams(teams)

  function submit(match: Match, form: HTMLFormElement) {
    const data = new FormData(form)
    const read = (name: string) => {
      const raw = String(data.get(name) ?? '').trim()
      return raw === '' ? null : Number(raw)
    }
    const scoreA = read('scoreA')
    const scoreB = read('scoreB')
    const limit = winsNeeded(match.bestOf)

    if ((scoreA !== null && scoreA > limit) || (scoreB !== null && scoreB > limit)) {
      setFeedback({ tone: 'error', text: `BO${match.bestOf} 单方最多 ${limit} 分` })
      return
    }
    const resolved = resolveMatch(match, matchIndex, teamIndex)
    if (!resolved.a || !resolved.b) {
      setFeedback({ tone: 'error', text: '对阵双方尚未确定，请刷新页面' })
      return
    }
    const teamAId = resolved.a.id
    const teamBId = resolved.b.id

    setFeedback(null)
    startTransition(async () => {
      try {
        const result = await confirmScoreWrite(
          confirmationToken =>
            recordScore(
              match.id,
              teamAId,
              teamBId,
              scoreA,
              scoreB,
              tournamentId,
              confirmationToken,
            ),
          message => window.confirm(message),
        )
        if (!result) return
        if (!result.ok) {
          setFeedback({ tone: 'error', text: result.error })
          return
        }

        const cleared = [
          result.reportCleared ? '本场战报' : '',
          result.cleared > 0 ? `${result.cleared} 场下游赛果` : '',
        ].filter(Boolean)
        setFeedback({
          tone: 'ok',
          text: cleared.length > 0 ? `比分已保存，并清空${cleared.join('及')}` : '比分已保存',
        })
        router.refresh()
      } catch {
        setFeedback({ tone: 'error', text: '网络异常，比分未保存' })
      }
    })
  }

  return (
    <>
      {feedback ? (
        <p
          role={feedback.tone === 'error' ? 'alert' : 'status'}
          style={{ color: feedback.tone === 'error' ? 'var(--c4)' : 'var(--ct)', marginBottom: 12 }}
        >
          {feedback.text}
        </p>
      ) : null}
      {groupByRound(matches).map(round => (
        <section key={round.round} style={{ marginBottom: 24 }}>
          <div className={styles.scoreRound}>{round.label}</div>
          <div className={styles.scoreGrid}>
            {round.matches.map(match => {
              const resolved = resolveMatch(match, matchIndex, teamIndex)
              return (
                <form
                  key={match.id}
                  className={styles.scoreCard}
                  onSubmit={event => {
                    event.preventDefault()
                    submit(match, event.currentTarget)
                  }}
                >
                  <div className={styles.scoreRow}>
                    <span>{resolved.a?.name ?? '待定'}</span>
                    <input
                      key={`a:${match.id}:${match.scoreA ?? 'empty'}`}
                      className={styles.scoreInput}
                      name="scoreA"
                      type="number"
                      min={0}
                      max={winsNeeded(match.bestOf)}
                      defaultValue={match.scoreA ?? ''}
                      disabled={!resolved.a || !resolved.b}
                      aria-label={`${resolved.a?.name ?? '待定战队'} 比分`}
                    />
                  </div>
                  <div className={styles.scoreRow}>
                    <span>{resolved.b?.name ?? '待定'}</span>
                    <input
                      key={`b:${match.id}:${match.scoreB ?? 'empty'}`}
                      className={styles.scoreInput}
                      name="scoreB"
                      type="number"
                      min={0}
                      max={winsNeeded(match.bestOf)}
                      defaultValue={match.scoreB ?? ''}
                      disabled={!resolved.a || !resolved.b}
                      aria-label={`${resolved.b?.name ?? '待定战队'} 比分`}
                    />
                  </div>
                  <div className={styles.rowActions}>
                    <Button
                      type="submit"
                      size="mini"
                      disabled={pending || !resolved.a || !resolved.b}
                    >
                      保存 BO{match.bestOf}
                    </Button>
                    {resolved.a && resolved.b ? (
                      <Link
                        href={`/admin/tournaments/${tournamentId}/matches/${match.id}`}
                        className="readout"
                      >
                        编辑战报 →
                      </Link>
                    ) : null}
                  </div>
                </form>
              )
            })}
          </div>
        </section>
      ))}
    </>
  )
}

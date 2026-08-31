'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { Button, Empty } from '@/components/ui'
import { groupByRound, indexMatches, indexTeams, resolveMatch, winsNeeded } from '@/lib/bracket'
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
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')

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
      setError(`BO${match.bestOf} 单方最多 ${limit} 分`)
      return
    }
    setError('')
    startTransition(async () => {
      const resolved = resolveMatch(match, matchIndex, teamIndex)
      if (!resolved.a || !resolved.b) {
        setError('对阵双方尚未确定，请刷新页面')
        return
      }
      const result = await recordScore(
        match.id,
        resolved.a.id,
        resolved.b.id,
        scoreA,
        scoreB,
        tournamentId,
      )
      if (!result.ok) setError(result.error)
    })
  }

  return (
    <>
      {error ? <p style={{ color: 'var(--c4)', marginBottom: 12 }}>{error}</p> : null}
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

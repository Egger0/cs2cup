import Link from 'next/link'
import { Empty } from '@/components/ui'
import { groupByRound, indexMatches, indexTeams, resolveMatch } from '@/lib/bracket'
import type { Match, PublicTeam } from '@/lib/types'
import styles from './Bracket.module.css'

export interface BracketProps {
  matches: Match[]
  teams: PublicTeam[]
  slug: string
}

export function Bracket({ matches, teams, slug }: BracketProps) {
  if (matches.length === 0) {
    return <Empty>报名满员后抽签,对阵表会出现在这里</Empty>
  }

  const matchIndex = indexMatches(matches)
  const teamIndex = indexTeams(teams)
  const rounds = groupByRound(matches)
  const lastRound = rounds.at(-1)?.round

  return (
    <div className={styles.scroll}>
      <div className={styles.board}>
        {rounds.map(round => (
          <div key={round.round} className={styles.round}>
            <div className={styles.roundLabel}>{round.label}</div>
            {round.matches.map(match => {
              const { a, b, winner } = resolveMatch(match, matchIndex, teamIndex)
              const sideClass = (team: PublicTeam | null) => {
                if (!winner || !team) return styles.side
                return team.id === winner.id
                  ? `${styles.side} ${styles.winner}`
                  : `${styles.side} ${styles.loser}`
              }

              return (
                <Link
                  key={match.id}
                  href={`/tournaments/${slug}/matches/${match.id}`}
                  className={[
                    styles.match,
                    winner ? styles.decided : '',
                    round.round === lastRound ? styles.final : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div className={sideClass(a)}>
                    <span className={a ? styles.name : `${styles.name} ${styles.pending}`}>
                      {a?.name ?? '待定'}
                    </span>
                    <span className={styles.score}>{match.scoreA ?? '–'}</span>
                  </div>
                  <div className={sideClass(b)}>
                    <span className={b ? styles.name : `${styles.name} ${styles.pending}`}>
                      {b?.name ?? '待定'}
                    </span>
                    <span className={styles.score}>{match.scoreB ?? '–'}</span>
                  </div>
                  <div className={styles.meta}>
                    <span>BO{match.bestOf}</span>
                    <span>
                      {match.scheduledAt
                        ? new Date(match.scheduledAt).toLocaleString('zh-CN', {
                            month: 'numeric',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '时间待定'}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

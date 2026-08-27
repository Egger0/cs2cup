import Link from 'next/link'
import { Button, Empty } from '@/components/ui'
import { groupByRound, indexMatches, indexTeams, isByeMatch, resolveMatch } from '@/lib/bracket'
import { formatSiteCompactDateTime } from '@/lib/datetime'
import type { Match, PublicTeam } from '@/lib/types'
import styles from './Bracket.module.css'

export interface BracketProps {
  matches: Match[]
  teams: PublicTeam[]
  slug: string
}

export function Bracket({ matches, teams, slug }: BracketProps) {
  if (matches.length === 0) {
    return (
      <Empty
        action={
          <Link href={`/tournaments/${slug}/teams`}>
            <Button size="mini">看参赛战队</Button>
          </Link>
        }
      >
        报名满员后统一抽签,对阵表会出现在这里。
      </Empty>
    )
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
              const bye = isByeMatch(match)
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
                      {a?.name ?? (bye ? '轮空' : '待定')}
                    </span>
                    <span className={styles.score}>{match.scoreA ?? '–'}</span>
                  </div>
                  <div className={sideClass(b)}>
                    <span className={b ? styles.name : `${styles.name} ${styles.pending}`}>
                      {b?.name ?? (bye ? '轮空' : '待定')}
                    </span>
                    <span className={styles.score}>{match.scoreB ?? '–'}</span>
                  </div>
                  <div className={styles.meta}>
                    <span>{bye ? '轮空晋级' : `BO${match.bestOf}`}</span>
                    {bye ? (
                      <span>无需比赛</span>
                    ) : match.scheduledAt ? (
                      <time dateTime={match.scheduledAt}>
                        {formatSiteCompactDateTime(match.scheduledAt) ?? '时间待定'}
                      </time>
                    ) : (
                      <span>时间待定</span>
                    )}
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

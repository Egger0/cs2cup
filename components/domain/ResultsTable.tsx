import Link from 'next/link'
import { Empty } from '@/components/ui'
import { indexMatches, indexTeams, resolveMatch } from '@/lib/bracket'
import type { Match, MatchMap, PublicTeam } from '@/lib/types'
import styles from './ResultsTable.module.css'

export interface ResultsTableProps {
  matches: Match[]
  teams: PublicTeam[]
  maps: MatchMap[]
  slug: string
}

export function ResultsTable({ matches, teams, maps, slug }: ResultsTableProps) {
  const decided = matches.filter(match => match.winnerTeamId !== null)
  if (decided.length === 0) return <Empty>还没有已完赛的比赛</Empty>

  const matchIndex = indexMatches(matches)
  const teamIndex = indexTeams(teams)
  const mapsByMatch = new Map<number, MatchMap[]>()
  for (const map of maps) {
    const list = mapsByMatch.get(map.matchId)
    if (list) list.push(map)
    else mapsByMatch.set(map.matchId, [map])
  }

  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>轮次</th>
            <th>对阵</th>
            <th style={{ textAlign: 'center' }}>比分</th>
            <th>图</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {decided.map(match => {
            const { a, b, winner } = resolveMatch(match, matchIndex, teamIndex)
            const played = (mapsByMatch.get(match.id) ?? []).filter(map => map.played)
            const cls = (team: PublicTeam | null) =>
              winner && team && team.id === winner.id ? styles.teamWin : styles.teamLose

            return (
              <tr key={match.id} className={styles.row}>
                <td className={styles.round}>{match.roundLabel}</td>
                <td className={styles.team}>
                  <span className={cls(a)}>{a?.name ?? '待定'}</span>
                  <span className={styles.tag}>vs</span>
                  <span className={cls(b)}> {b?.name ?? '待定'}</span>
                </td>
                <td className={styles.score}>
                  {match.scoreA} : {match.scoreB}
                </td>
                <td className={styles.maps}>
                  {played.map(map => map.mapName).join(' / ') || '—'}
                </td>
                <td>
                  <Link href={`/tournaments/${slug}/matches/${match.id}`} className={styles.link}>
                    战报 →
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

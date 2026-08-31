import Link from 'next/link'
import { Button, Empty } from '@/components/ui'
import { indexMatches, indexTeams, isCompletedMatch, resolveMatch } from '@/lib/bracket'
import type { Match, MatchMap, PublicTeam } from '@/lib/types'
import styles from './ResultsTable.module.css'

interface ResultsTableProps {
  matches: Match[]
  teams: PublicTeam[]
  maps: MatchMap[]
  slug: string
  limit?: number
}

export function ResultsTable({ matches, teams, maps, slug, limit }: ResultsTableProps) {
  const all = matches.filter(isCompletedMatch)
  const decided = limit === undefined ? all : all.slice(-limit)
  if (decided.length === 0) {
    return (
      <Empty
        action={
          <Link href={`/tournaments/${slug}/bracket`}>
            <Button size="mini">看对阵表</Button>
          </Link>
        }
      >
        还没有打完的比赛。每场结束后,比分和 Ban/Pick 会出现在这里。
      </Empty>
    )
  }

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
                <td className={styles.maps}>{played.map(map => map.mapName).join(' / ') || '—'}</td>
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

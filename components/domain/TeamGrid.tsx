import Link from 'next/link'
import { Button, Empty } from '@/components/ui'
import type { PublicTeam } from '@/lib/types'
import styles from './TeamGrid.module.css'

export function TeamGrid({ teams, slug }: { teams: PublicTeam[]; slug?: string }) {
  if (teams.length === 0) {
    return (
      <Empty
        action={
          slug ? (
            <Link href={`/tournaments/${slug}/register`}>
              <Button variant="primary">第一个报名</Button>
            </Link>
          ) : null
        }
      >
        还没有战队通过审核。报名后由主办方确认,通过的队伍会出现在这里。
      </Empty>
    )
  }

  return (
    <div className={styles.grid}>
      {teams.map(team => (
        <article key={team.id} className={styles.card}>
          <div className={styles.head}>
            <span className={styles.seed}>{team.seed ? `#${team.seed}` : '—'}</span>
            <span className={styles.tag}>{team.tag}</span>
          </div>
          <h3 className={styles.name}>{team.name}</h3>
          <p className={styles.meta}>
            队长 {team.captain}
            {team.dept ? ` · ${team.dept}` : ''}
          </p>
          {team.players.length > 0 ? (
            <ul className={styles.roster}>
              {team.players.map(player => (
                <li key={player.id} className={styles.player}>
                  <span className={styles.playerName}>{player.nickname}</span>
                  <span className={styles.playerRole}>
                    {player.isSubstitute ? '替补' : (player.role ?? '')}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </article>
      ))}
    </div>
  )
}

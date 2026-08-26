import { Empty } from '@/components/ui'
import type { PublicTeam } from '@/lib/types'
import styles from './TeamGrid.module.css'

export function TeamGrid({ teams }: { teams: PublicTeam[] }) {
  if (teams.length === 0) return <Empty>还没有战队通过审核</Empty>

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
            <p className={styles.roster}>
              {team.players
                .map(player => (player.isSubstitute ? `${player.nickname}(替补)` : player.nickname))
                .join('、')}
            </p>
          ) : null}
        </article>
      ))}
    </div>
  )
}

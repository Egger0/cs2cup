import type { PublicTeam } from '@/lib/types'
import styles from './SeatGrid.module.css'

export interface SeatGridProps {
  teams: PublicTeam[]
  capacity: number
  statusLabel: string
}

export function SeatGrid({ teams, capacity, statusLabel }: SeatGridProps) {
  const seats = Array.from({ length: capacity }, (_, index) => teams[index] ?? null)
  const taken = teams.length
  const open = Math.max(0, capacity - taken)

  return (
    <div className={styles.frame}>
      <span className={styles.sweep} aria-hidden />

      <div className={styles.head}>
        <div>
          <div className="readout">席位</div>
          <div className={styles.tally}>
            {String(taken).padStart(2, '0')}
            <span className={styles.tallyTotal}>/{capacity}</span>
          </div>
        </div>
        <span className="readout">{statusLabel}</span>
      </div>

      <ul className={styles.grid}>
        {seats.map((team, index) => (
          <li
            key={team ? `team-${team.id}` : `open-${index}`}
            className={team ? `${styles.seat} ${styles.taken}` : `${styles.seat} ${styles.open}`}
          >
            {team ? (
              <>
                <span className={styles.tag}>{team.tag}</span>
                <span className={styles.seed}>{team.seed ? `SEED ${team.seed}` : '未定种子'}</span>
              </>
            ) : (
              <span className={styles.slot}>{String(index + 1).padStart(2, '0')}</span>
            )}
          </li>
        ))}
      </ul>

      <div className={styles.meter}>
        <span className={styles.meterFill} style={{ width: `${(taken / capacity) * 100}%` }} />
      </div>

      <div className={styles.foot}>
        <span className="readout">{open > 0 ? `${open} 个空位` : '席位已满'}</span>
        <span className="readout">先到先得</span>
      </div>
    </div>
  )
}

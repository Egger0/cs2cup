import type { CSSProperties } from 'react'
import { LOADOUT_STATS } from '@/lib/delta-loadouts'
import type { LoadoutStats } from '@/lib/loadout-input'
import styles from './LoadoutStatBars.module.css'

export function LoadoutStatBars({
  stats,
  base,
  compact = false,
}: {
  stats: LoadoutStats
  base: LoadoutStats | null
  compact?: boolean
}) {
  return (
    <dl className={styles.stats} data-compact={compact ? '' : undefined}>
      {LOADOUT_STATS.map(([key, label]) => {
        const delta = base ? stats[key] - base[key] : 0
        return (
          <div key={key} className={styles.stat}>
            <dt>{label}</dt>
            <dd>
              {key === 'distance' ? null : (
                <span
                  className={styles.bar}
                  style={
                    { '--value': Math.max(0, Math.min(stats[key], 100)) / 100 } as CSSProperties
                  }
                  aria-hidden="true"
                />
              )}
              <b>
                {stats[key]}
                {key === 'distance' ? <small>m</small> : null}
              </b>
              <i data-sign={delta > 0 ? 'up' : delta < 0 ? 'down' : undefined}>
                {delta ? `${delta > 0 ? '+' : ''}${delta}` : ''}
              </i>
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

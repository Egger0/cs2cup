import { Empty } from '@/components/ui'
import type { MapStat } from '@/lib/mapstats'
import styles from './MapStats.module.css'

export function MapStats({ stats }: { stats: MapStat[] }) {
  if (stats.length === 0) return <Empty>还没有 Ban/Pick 记录</Empty>

  const max = Math.max(1, ...stats.map(stat => stat.played))

  return (
    <div className={styles.table}>
      <div className={`${styles.row} ${styles.head}`}>
        <span>地图</span>
        <span className={styles.num}>被选</span>
        <span className={styles.num}>被 Ban</span>
        <span className={styles.num}>实战场次</span>
      </div>
      {stats.map(stat => (
        <div key={stat.name} className={styles.row}>
          <span className={styles.fill} style={{ width: `${(stat.played / max) * 100}%` }} />
          <span className={styles.name}>{stat.name}</span>
          <span className={`${styles.num} ${styles.pick}`}>{stat.picked + stat.decider}</span>
          <span className={`${styles.num} ${styles.ban}`}>{stat.banned}</span>
          <span
            className={`${styles.num} ${stat.played > 0 ? styles.played : styles.unplayed}`}
          >
            {stat.played}
          </span>
        </div>
      ))}
    </div>
  )
}

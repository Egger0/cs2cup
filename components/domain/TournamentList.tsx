import Link from 'next/link'
import { Empty } from '@/components/ui'
import type { Tournament, TournamentStatus } from '@/lib/types'
import styles from './TournamentList.module.css'

const STATE: Record<TournamentStatus, string> = {
  draft: '筹备中',
  registration: '报名中',
  running: '进行中',
  finished: '已结束',
  postponed: '延期中',
}

export function TournamentList({ tournaments }: { tournaments: Tournament[] }) {
  if (tournaments.length === 0) return <Empty>还没有赛事</Empty>

  return (
    <div className={styles.list}>
      {tournaments.map(tournament => (
        <Link key={tournament.id} href={`/tournaments/${tournament.slug}`} className={styles.row}>
          <span className={styles.year}>{tournament.season.replace(/[^0-9]/g, '')}</span>
          <span>
            <span className={styles.title}>{tournament.title}</span>
            <span className={styles.meta}>
              {tournament.gameName ?? ''} · 第 {tournament.edition} 届 · {tournament.teamCap} 队
            </span>
          </span>
          <span
            className={
              tournament.status === 'finished'
                ? `${styles.state} ${styles.done}`
                : `${styles.state} ${styles.live}`
            }
          >
            {STATE[tournament.status]}
          </span>
        </Link>
      ))}
    </div>
  )
}

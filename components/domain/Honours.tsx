import Link from 'next/link'
import { Empty } from '@/components/ui'
import type { Tournament } from '@/lib/types'
import styles from './Honours.module.css'

export interface Honour {
  tournament: Tournament
  champion: string | null
}

function Trophy() {
  return (
    <svg className={styles.trophy} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M7 4h10v5a5 5 0 0 1-10 0V4Z M7 5H4v2a3 3 0 0 0 3 3 M17 5h3v2a3 3 0 0 1-3 3 M12 14v4 M9 20h6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function Honours({ honours }: { honours: Honour[] }) {
  if (honours.length === 0) return <Empty>还没有完赛的赛事</Empty>

  return (
    <div className={styles.wall}>
      {honours.map(({ tournament, champion }) => (
        <Link
          key={tournament.id}
          href={`/tournaments/${tournament.slug}`}
          className={styles.entry}
        >
          <div className={styles.year}>{tournament.season.replace(/[^0-9]/g, '')}</div>
          <div className={styles.edition}>
            第 {tournament.edition} 届 · {tournament.gameName ?? ''}
          </div>
          <div className={styles.cup}>
            <Trophy />
            {champion ? (
              <span className={styles.champion}>{champion}</span>
            ) : (
              <span className={styles.pending}>冠军待补录</span>
            )}
          </div>
          {tournament.championNote ? (
            <p className={styles.note}>{tournament.championNote}</p>
          ) : null}
        </Link>
      ))}
    </div>
  )
}

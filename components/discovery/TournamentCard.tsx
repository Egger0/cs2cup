import Link from 'next/link'
import { Icon } from '@/components/ui/Icon'
import { formatSiteDate } from '@/lib/datetime'
import { TOURNAMENT_STATES } from '@/lib/tournament-discovery'
import type { Tournament } from '@/lib/types'
import { FollowTournament } from './FollowTournament'
import styles from './TournamentCard.module.css'

export function TournamentCard({ tournament }: { tournament: Tournament }) {
  const base = `/tournaments/${tournament.slug}`
  const date = tournament.status === 'registration' ? tournament.regDeadline : tournament.startsAt
  return (
    <article className={styles.card}>
      <div className={styles.topline}>
        <span>
          {tournament.gameName ?? '校园电竞'} / {tournament.season}
        </span>
        <span className={styles.status} data-status={tournament.status}>
          <i aria-hidden="true" />
          {TOURNAMENT_STATES[tournament.status]}
        </span>
      </div>
      <Link href={base} className={styles.mainLink}>
        <span className={styles.edition}>
          EDITION <strong>{String(tournament.edition).padStart(2, '0')}</strong>
        </span>
        <h3>{tournament.title}</h3>
        <p>{tournament.lede || '一起上场，把热爱写进校园。'}</p>
        <span className={styles.enter}>
          查看赛事
          <Icon name="diagonal" />
        </span>
      </Link>
      <div className={styles.details}>
        <span>
          <Icon name="calendar" size={15} />
          {date
            ? `${formatSiteDate(date) ?? '时间待定'}${tournament.status === 'registration' ? ' 截止报名' : ' 开赛'}`
            : '日期待公布'}
        </span>
        <span>最多 {tournament.teamCap} 支战队</span>
      </div>
      <div className={styles.footer}>
        <Link href={`${base}/schedule`}>
          比赛日程 <Icon name="arrow" size={15} />
        </Link>
        <FollowTournament id={tournament.id} title={tournament.title} />
      </div>
    </article>
  )
}

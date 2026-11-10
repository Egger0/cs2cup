import Link from 'next/link'
import { Icon } from '@/components/ui/Icon'
import { formatSiteCompactDateTime, formatSiteDate } from '@/lib/datetime'
import type { Post } from '@/lib/types'
import styles from './HomePulse.module.css'

export interface UpcomingMatch {
  id: number
  href: string
  round: string
  teamA: string
  teamB: string
  at: string
}

export function HomePulse({ posts, upcoming }: { posts: Post[]; upcoming: UpcomingMatch[] }) {
  if (!posts.length && !upcoming.length) return null
  return (
    <div className={styles.pulse} data-home-reveal="group">
      {posts.length ? (
        <section className={styles.news} aria-labelledby="pulse-news">
          <header>
            <h3 id="pulse-news">社团近况</h3>
            <Link href="/news">
              全部动态 <Icon name="arrow" size={14} />
            </Link>
          </header>
          <div className={styles.cards}>
            {posts.slice(0, 3).map(post => (
              <Link key={post.id} href={`/news/${post.slug}`} className={styles.card}>
                <time dateTime={post.publishedAt}>
                  {formatSiteDate(post.publishedAt) ?? post.publishedAt}
                </time>
                <strong>{post.title}</strong>
                <p>{post.summary}</p>
                <Icon name="diagonal" size={16} />
              </Link>
            ))}
          </div>
        </section>
      ) : null}
      {upcoming.length ? (
        <section className={styles.matches} aria-labelledby="pulse-matches">
          <header>
            <h3 id="pulse-matches">即将开赛</h3>
          </header>
          <ol>
            {upcoming.map(match => (
              <li key={match.id}>
                <Link href={match.href}>
                  <span className={styles.round}>{match.round}</span>
                  <span className={styles.teams}>
                    <b>{match.teamA}</b>
                    <i>vs</i>
                    <b>{match.teamB}</b>
                  </span>
                  <time dateTime={match.at}>{formatSiteCompactDateTime(match.at)}</time>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  )
}

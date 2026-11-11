import Link from 'next/link'
import { Icon } from '@/components/ui/Icon'
import { fixturesEntry } from '@/lib/tournament-format'
import type { Post, Tournament } from '@/lib/types'
import { HomePulse, type UpcomingMatch } from './HomePulse'
import styles from './HomeHub.module.css'
import motionStyles from './HomeMotion.module.css'

export function HomeHub({
  tournament,
  posts,
  upcoming,
}: {
  tournament: Tournament | null
  posts: Post[]
  upcoming: UpcomingMatch[]
}) {
  const steps = [
    {
      label: '组队参赛',
      detail: '创建账号、申请成员资格，和队友一起提交报名。',
      href: tournament ? `/tournaments/${tournament.slug}/register` : '/register',
    },
    {
      label: '跟进赛程',
      detail: '找到支持的战队，把比赛时间加入你的日历。',
      href: tournament
        ? `/tournaments/${tournament.slug}${fixturesEntry(tournament).path}`
        : '/tournaments',
    },
    {
      label: '加入电竞社',
      detail: '解说、导播、设计、摄影。赛场之外，同样精彩。',
      href: '/about#join',
    },
  ]
  return (
    <section
      id="clubhouse"
      data-zone="clubhouse"
      className={`${styles.hub} ${motionStyles.hubMotion}`}
      aria-labelledby="clubhouse-title"
    >
      <div className="wrap">
        <header className={styles.heading} data-home-reveal="item">
          <div>
            <h2 id="clubhouse-title">热爱，有了集合地。</h2>
          </div>
          <Link href="/tournaments">
            进入赛事大厅 <Icon name="arrow" />
          </Link>
        </header>
        <nav className={styles.pathways} aria-label="参赛与社团指南" data-home-reveal="group">
          {steps.map(step => (
            <Link key={step.href} href={step.href}>
              <h3>
                {step.label}
                <Icon name="diagonal" />
              </h3>
              <p>{step.detail}</p>
            </Link>
          ))}
        </nav>
        <HomePulse posts={posts} upcoming={upcoming} />
      </div>
    </section>
  )
}

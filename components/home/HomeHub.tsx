import Link from 'next/link'
import { Icon } from '@/components/ui/Icon'
import type { Post, Tournament } from '@/lib/types'
import styles from './HomeHub.module.css'
import motionStyles from './HomeMotion.module.css'

export function HomeHub({ tournament, posts }: { tournament: Tournament | null; posts: Post[] }) {
  const steps = [
    {
      title: '想上场',
      label: '组队参赛',
      detail: '创建账号、申请成员资格，和队友一起提交报名。',
      href: tournament ? `/tournaments/${tournament.slug}/register` : '/register',
      number: '01',
    },
    {
      title: '来看比赛',
      label: '跟进赛程',
      detail: '找到支持的战队，把比赛时间加入你的日历。',
      href: tournament ? `/tournaments/${tournament.slug}/schedule` : '/tournaments',
      number: '02',
    },
    {
      title: '成为其中一员',
      label: '加入电竞社',
      detail: '解说、导播、设计、摄影。赛场之外，同样精彩。',
      href: '/about#join',
      number: '03',
    },
  ]
  return (
    <section
      id="clubhouse"
      className={`${styles.hub} ${motionStyles.hubMotion}`}
      data-header-tone="light"
      aria-labelledby="clubhouse-title"
    >
      <div className="wrap">
        <header className={styles.heading} data-home-reveal="item">
          <div>
            <span>THE CLUBHOUSE / 宁理电竞</span>
            <h2 id="clubhouse-title">热爱，有了集合地。</h2>
          </div>
          <Link href="/tournaments">
            进入赛事大厅 <Icon name="arrow" />
          </Link>
        </header>
        <nav className={styles.pathways} aria-label="参赛与社团指南" data-home-reveal="group">
          {steps.map(step => (
            <Link key={step.number} href={step.href}>
              <span className={styles.number}>{step.number}</span>
              <span className={styles.role}>{step.title}</span>
              <h3>
                {step.label}
                <Icon name="diagonal" />
              </h3>
              <p>{step.detail}</p>
            </Link>
          ))}
        </nav>
        {posts.length ? (
          <div className={styles.journal}>
            <span className={styles.journalLabel}>社团近况 / JOURNAL</span>
            {posts.slice(0, 2).map(post => (
              <Link key={post.id} href={`/news/${post.slug}`}>
                <span>{post.title}</span>
                <Icon name="arrow" size={16} />
              </Link>
            ))}
            <Link href="/news" className={styles.allNews}>
              全部动态 ↗
            </Link>
          </div>
        ) : null}
      </div>
    </section>
  )
}

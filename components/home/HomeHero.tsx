import Link from 'next/link'
import type { HomeTournamentSignal } from '@/lib/home-tournament-signal'
import { Icon } from '@/components/ui/Icon'
import { HomeSignalChip } from './HomeSignalChip'
import styles from './HomeHero.module.css'

const ENTRY = `try{var d=document.documentElement,s=sessionStorage,r=matchMedia('(prefers-reduced-motion: reduce)').matches;d.dataset.homeEntry=s.getItem('solar-entry')||r?'instant':'intro';s.setItem('solar-entry','1')}catch(e){document.documentElement.dataset.homeEntry='instant'}`

export function HomeHero({
  signal,
  stops,
  current,
}: {
  signal: HomeTournamentSignal | null
  stops: string[]
  current: string | null
}) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: ENTRY }} />
      <section className={styles.hero} aria-labelledby="home-title" data-solar-chapter="overview">
        <div className={styles.copy} data-solar-reserve>
          <p className={styles.eyebrow}>NINGLI ESPORTS CLUB · EST. 2022</p>
          <h1 id="home-title" aria-label="宁理电竞社">
            <span>宁理</span>
            <span>
              电竞社
              <span className={styles.point} aria-hidden="true" />
            </span>
          </h1>
          <p className={styles.tagline}>在宁理，为热爱上场。</p>
          <div className={styles.actions}>
            <Link href="/tournaments" className={styles.primary}>
              浏览全部赛事 <Icon name="arrow" size={16} />
            </Link>
            <Link href="/about#join" className={styles.secondary}>
              加入电竞社 <Icon name="diagonal" size={16} />
            </Link>
          </div>
        </div>
        <HomeSignalChip signal={signal} current={current} />
        <a href="#clubhouse" className={styles.flow} aria-label="向下探索主场">
          <span>向下探索主场</span>
          <i aria-hidden="true" />
        </a>
      </section>
      <div className={styles.tour} aria-hidden="true">
        {stops.map(stop => (
          <div key={stop} className={styles.stop} data-solar-chapter={stop} />
        ))}
      </div>
    </>
  )
}

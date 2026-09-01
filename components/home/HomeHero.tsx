import Link from 'next/link'
import { HomeBracket } from './HomeBracket'
import styles from './HomeHero.module.css'

export function HomeHero() {
  return (
    <section
      className={styles.cover}
      aria-labelledby="home-title"
      data-home-cover
      data-header-tone="dark"
    >
      <div className={styles.canvas}>
        <div className={styles.meta}>
          <span>浙大宁波理工学院</span>
          <span>2022—</span>
        </div>

        <HomeBracket />

        <div className={styles.titleBlock}>
          <p>NINGLI ESPORTS CLUB</p>
          <h1 id="home-title" aria-label="宁理电竞社">
            <span>宁理</span>
            <span>电竞社</span>
          </h1>
        </div>

        <div className={styles.finalLabel} aria-hidden="true">
          <span>FINAL</span>
          <strong>01</strong>
        </div>

        <a href="#route" className={styles.scrollCue} aria-label="继续浏览赛事路径">
          <span>SCROLL</span>
          <strong>02</strong>
          <i aria-hidden="true" />
        </a>

        <Link href="/tournaments" className={styles.enter}>
          <span>进入赛事</span>
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  )
}

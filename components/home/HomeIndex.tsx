import Link from 'next/link'
import motionStyles from './HomeMotion.module.css'
import styles from './HomeIndex.module.css'

const ROLES = [
  { glyph: '打', label: '选手' },
  { glyph: '说', label: '解说' },
  { glyph: '播', label: '导播' },
  { glyph: '做', label: '设计' },
]

const LINKS = [
  { href: '/tournaments', label: '赛事', detail: '宁理杯' },
  { href: '/news', label: '动态', detail: '最近更新' },
  { href: '/archive', label: '往届', detail: '2022—' },
  { href: '/about#join', label: '加入', detail: '成为其中一员' },
]

export function HomeIndex() {
  return (
    <section
      className={`${styles.index} ${motionStyles.indexMotion}`}
      aria-labelledby="home-index-title"
      data-header-tone="dark"
    >
      <div className={styles.inner}>
        <header className={styles.heading} data-home-reveal="item">
          <p>社团分工 / 04 ROLES</p>
          <h2 id="home-index-title">不只选手。</h2>
        </header>

        <ul className={styles.roles} aria-label="社团角色" data-home-reveal="group">
          {ROLES.map(role => (
            <li key={role.glyph}>
              <strong aria-hidden="true">{role.glyph}</strong>
              <span>{role.label}</span>
            </li>
          ))}
        </ul>

        <nav className={styles.links} aria-label="首页入口" data-home-reveal="group">
          {LINKS.map(link => (
            <Link key={link.href} href={link.href}>
              <span className={styles.label}>{link.label}</span>
              <span className={styles.detail}>{link.detail}</span>
              <span className={styles.arrow} aria-hidden="true">
                →
              </span>
            </Link>
          ))}
        </nav>
      </div>
    </section>
  )
}

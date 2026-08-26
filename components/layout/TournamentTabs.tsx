'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import styles from './TournamentShell.module.css'

export interface TournamentTab {
  href: string
  label: string
  count?: number
  exact?: boolean
}

export function TournamentTabs({ tabs }: { tabs: TournamentTab[] }) {
  const pathname = usePathname()

  return (
    <nav className={styles.tabs} aria-label="赛事导航">
      {tabs.map(tab => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname === tab.href || pathname.startsWith(`${tab.href}/`)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={active ? `${styles.tab} ${styles.active}` : styles.tab}
            aria-current={active ? 'page' : undefined}
          >
            {tab.label}
            {tab.count !== undefined ? <span className={styles.count}>{tab.count}</span> : null}
          </Link>
        )
      })}
    </nav>
  )
}

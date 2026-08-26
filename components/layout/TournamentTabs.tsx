'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import type { MouseEvent } from 'react'
import styles from './TournamentShell.module.css'

export interface TournamentTab {
  href: string
  label: string
  count?: number
  exact?: boolean
}

type StartViewTransition = (callback: () => void) => { finished: Promise<void> }

function supportsViewTransition(): StartViewTransition | null {
  if (typeof document === 'undefined') return null
  const start = (document as Document & { startViewTransition?: StartViewTransition })
    .startViewTransition
  if (typeof start !== 'function') return null
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null
  return start.bind(document)
}

export function TournamentTabs({ tabs }: { tabs: TournamentTab[] }) {
  const pathname = usePathname()
  const router = useRouter()

  function navigate(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
    const start = supportsViewTransition()
    if (!start) return

    event.preventDefault()
    start(() => {
      router.push(href)
    })
  }

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
            onClick={event => navigate(event, tab.href)}
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

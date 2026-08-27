'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, type MouseEvent } from 'react'
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
  const tabsRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const rail = tabsRef.current
    const active = rail?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!rail || !active) return

    let disposed = false
    const revealActiveTab = () => {
      if (disposed) return
      const railBox = rail.getBoundingClientRect()
      const activeBox = active.getBoundingClientRect()
      rail.scrollTo({
        left:
          rail.scrollLeft +
          activeBox.left -
          railBox.left -
          (railBox.width - activeBox.width) / 2,
        behavior: 'auto',
      })
    }

    const frame = window.requestAnimationFrame(revealActiveTab)
    const observer = new ResizeObserver(revealActiveTab)
    observer.observe(rail)
    observer.observe(active)
    void document.fonts.ready.then(revealActiveTab)

    return () => {
      disposed = true
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [pathname])

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
    <nav ref={tabsRef} className={styles.tabs} aria-label="赛事导航">
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

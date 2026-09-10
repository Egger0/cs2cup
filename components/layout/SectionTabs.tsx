'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import styles from './SectionTabs.module.css'

export interface SectionTab {
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

export function SectionTabs({
  tabs,
  label = '赛事导航',
  trailing,
}: {
  tabs: SectionTab[]
  label?: string
  trailing?: ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const tabsRef = useRef<HTMLElement>(null)
  const [scrollable, setScrollable] = useState(false)

  useEffect(() => {
    const rail = tabsRef.current
    if (!rail) return
    const active = rail.querySelector<HTMLElement>('[aria-current="page"]')

    let disposed = false
    const measure = () => {
      if (disposed) return
      setScrollable(rail.scrollWidth > rail.clientWidth + 1)
      if (!active) return
      const railBox = rail.getBoundingClientRect()
      const activeBox = active.getBoundingClientRect()
      rail.scrollTo({
        left:
          rail.scrollLeft + activeBox.left - railBox.left - (railBox.width - activeBox.width) / 2,
        behavior: 'auto',
      })
    }

    const frame = window.requestAnimationFrame(measure)
    const observer = new ResizeObserver(measure)
    observer.observe(rail)
    if (active) observer.observe(active)
    void document.fonts.ready.then(measure)

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
    <div className={styles.tabsWrap}>
      {scrollable ? (
        <span className={styles.scrollHint} aria-hidden="true">
          左右滑动查看更多 <span>↔</span>
        </span>
      ) : null}
      <div className={styles.row}>
        <nav ref={tabsRef} className={styles.tabs} aria-label={label}>
          {tabs.map((tab, index) => {
            const target = tab.href.split('#', 1)[0]
            const active = tab.exact
              ? pathname === target
              : pathname === target || pathname.startsWith(`${target}/`)
            return (
              <Link
                key={tab.href}
                href={tab.href}
                onClick={event => navigate(event, tab.href)}
                className={active ? `${styles.tab} ${styles.active}` : styles.tab}
                aria-current={active ? 'page' : undefined}
              >
                <span className={styles.index} aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                {tab.label}
                {tab.count !== undefined ? <span className={styles.count}>{tab.count}</span> : null}
              </Link>
            )
          })}
        </nav>
        {trailing ? <div className={styles.trailing}>{trailing}</div> : null}
      </div>
    </div>
  )
}

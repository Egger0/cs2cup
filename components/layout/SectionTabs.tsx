'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import styles from './SectionTabs.module.css'
import { transitionTo } from './view-transition'

export interface SectionTab {
  href: string
  label: string
  count?: number
  exact?: boolean
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
                onClick={event => transitionTo(event, tab.href, href => router.push(href))}
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

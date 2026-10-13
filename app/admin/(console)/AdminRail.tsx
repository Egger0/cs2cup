'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, type ReactNode } from 'react'
import styles from './AdminRail.module.css'

interface RailLink {
  index: string
  href: string
  label: string
  exact?: boolean
}

export function AdminRail({
  groups,
  trailing,
}: {
  groups: { label: string; links: RailLink[] }[]
  trailing?: ReactNode
}) {
  const pathname = usePathname()
  const nav = useRef<HTMLElement>(null)

  useEffect(() => {
    const rail = nav.current
    const active = rail?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!rail || !active || rail.scrollWidth <= rail.clientWidth) return
    rail.scrollTo({
      left: active.offsetLeft - (rail.clientWidth - active.offsetWidth) / 2,
      behavior: 'auto',
    })
  }, [pathname])

  return (
    <aside className={styles.rail}>
      <nav ref={nav} className={styles.nav} aria-label="后台导航">
        {groups.map(group => (
          <div key={group.label} className={styles.group} role="group" aria-label={group.label}>
            <span className={styles.heading} aria-hidden="true">
              {group.label}
            </span>
            {group.links.map(link => {
              const active = link.exact
                ? pathname === link.href
                : pathname === link.href || pathname.startsWith(`${link.href}/`)
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={styles.link}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className={styles.index} aria-hidden="true">
                    {link.index}
                  </span>
                  {link.label}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>
      {trailing ? <div className={styles.session}>{trailing}</div> : null}
    </aside>
  )
}

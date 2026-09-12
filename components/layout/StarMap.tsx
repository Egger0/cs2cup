'use client'

import Link from 'next/link'
import { useState, type CSSProperties, type Ref } from 'react'
import type { SiteNavLink } from './SiteHeaderFallback'
import { StarOrbit } from './StarOrbit'
import styles from './StarMap.module.css'

const ENGLISH: Record<string, string> = {
  '/tournaments': 'TOURNAMENTS',
  '/news': 'JOURNAL',
  '/archive': 'ARCHIVE',
  '/games': 'GAMES',
  '/about': 'ABOUT',
  '/guestbook': 'GUESTBOOK',
  '/lottery': 'RECRUIT DRAW',
  '/search': 'SEARCH',
  '/me': 'MY EVENTS',
  '/account': 'MY ACCOUNT',
  '/account/security': 'SIGN-IN & SECURITY',
  '/admin': 'WORKBENCH',
  '/login': 'LOGIN',
  '/register': 'CREATE ACCOUNT',
}
const DOCUMENT_LINKS = new Set(['/me', '/account', '/account/security', '/admin'])

export function StarMap({
  ref,
  open,
  origin,
  links,
  active,
  school,
  onNavigate,
}: {
  ref: Ref<HTMLElement>
  open: boolean
  origin: string
  links: SiteNavLink[]
  active: number
  school: string
  onNavigate: () => void
}) {
  const [hot, setHot] = useState<number | null>(null)

  return (
    <div
      id="site-menu"
      className={styles.menu}
      data-open={open || undefined}
      aria-hidden={!open}
      inert={!open}
      style={{ '--origin': origin } as CSSProperties}
    >
      <div className={styles.inner}>
        <nav ref={ref} className={styles.index} aria-label="全部页面">
          <div className={styles.meta}>
            <span>STAR MAP / {String(links.length).padStart(2, '0')}</span>
            <span>{school} · 2022—</span>
          </div>
          <ol className={styles.list} onMouseLeave={() => setHot(null)}>
            {links.map((link, index) => {
              const current = index === active
              const content = (
                <>
                  <span className={styles.number}>{String(index + 1).padStart(2, '0')}</span>
                  <span className={styles.label}>
                    <strong>{link.label}</strong>
                    <small>{ENGLISH[link.href]}</small>
                  </span>
                  <span className={styles.arrow} aria-hidden="true">
                    ↗
                  </span>
                </>
              )
              const shared = {
                href: link.href,
                className: current ? styles.active : undefined,
                'aria-current': current ? ('page' as const) : undefined,
                onClick: onNavigate,
                onMouseEnter: () => setHot(index),
                onFocus: () => setHot(index),
              }
              return (
                <li key={link.href} style={{ '--i': index } as CSSProperties}>
                  {DOCUMENT_LINKS.has(link.href) ? (
                    <a {...shared}>{content}</a>
                  ) : (
                    <Link {...shared}>{content}</Link>
                  )}
                </li>
              )
            })}
          </ol>
          <div className={styles.foot}>
            <span>NINGLI ESPORTS CLUB</span>
            <span>ESC 关闭</span>
          </div>
        </nav>
        <StarOrbit
          links={links}
          codes={links.map(link => ENGLISH[link.href] ?? '')}
          lit={hot ?? active}
          active={active}
          open={open}
        />
      </div>
    </div>
  )
}

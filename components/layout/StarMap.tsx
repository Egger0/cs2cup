'use client'

import Link from 'next/link'
import type { CSSProperties, Ref } from 'react'
import type { SiteNavLink } from './SiteHeaderFallback'
import styles from './StarMap.module.css'

const DOCUMENT_LINKS = new Set(['/me', '/account', '/account/security', '/admin'])

export function StarMap({
  ref,
  open,
  origin,
  links,
  active,
  onNavigate,
}: {
  ref: Ref<HTMLElement>
  open: boolean
  origin: string
  links: SiteNavLink[]
  active: number
  onNavigate: () => void
}) {
  const groups = new Map<string, (SiteNavLink & { index: number })[]>()
  links.forEach((link, index) => {
    const group = link.group ?? '我的'
    groups.set(group, [...(groups.get(group) ?? []), { ...link, index }])
  })
  return (
    <>
      <div
        className={styles.scrim}
        data-open={open || undefined}
        aria-hidden="true"
        onClick={onNavigate}
      />
      <div
        id="site-menu"
        className={styles.menu}
        data-open={open || undefined}
        aria-hidden={!open}
        inert={!open}
        style={{ '--origin': origin } as CSSProperties}
      >
        <nav ref={ref} className={styles.index} aria-label="全部页面">
          {[...groups].map(([group, items]) => (
            <section key={group} className={styles.group}>
              <h2>{group}</h2>
              <ul>
                {items.map(link => {
                  const shared = {
                    href: link.href,
                    'aria-current': link.index === active ? ('page' as const) : undefined,
                    onClick: onNavigate,
                  }
                  return (
                    <li key={link.href}>
                      {DOCUMENT_LINKS.has(link.href) ? (
                        <a {...shared}>{link.label}</a>
                      ) : (
                        <Link {...shared} prefetch={false}>
                          {link.label}
                        </Link>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </nav>
      </div>
    </>
  )
}

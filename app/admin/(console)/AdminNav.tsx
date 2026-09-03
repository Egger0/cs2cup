'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import styles from './shell.module.css'

const LINKS = [
  { href: '/admin', label: '报名与赛果', exact: true },
  { href: '/admin/identity', label: '资格审核' },
  { href: '/admin/tournaments', label: '赛事' },
  { href: '/admin/games', label: '项目' },
  { href: '/admin/posts', label: '动态' },
  { href: '/admin/photos', label: '素材' },
  { href: '/admin/members', label: '成员' },
  { href: '/admin/guestbook', label: '留言' },
  { href: '/admin/settings', label: '设置' },
]

export function AdminNav() {
  const pathname = usePathname()
  const railRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const active = railRef.current?.querySelector<HTMLElement>('[aria-current="page"]')
    active?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [pathname])

  return (
    <div className={styles.navViewport}>
      <nav ref={railRef} className={styles.nav} aria-label="后台导航">
        {LINKS.map((link, index) => {
          const active = link.exact ? pathname === link.href : pathname.startsWith(link.href)
          return (
            <Link
              key={link.href}
              href={link.href}
              className={active ? `${styles.navLink} ${styles.navActive}` : styles.navLink}
              aria-current={active ? 'page' : undefined}
            >
              <span className={styles.navIndex} aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span>{link.label}</span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

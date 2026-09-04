'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { PlatformConsoleCapability } from '@/lib/auth'
import styles from './shell.module.css'

const LINKS = [
  { href: '/admin', label: '报名与赛果', exact: true, capability: 'platform.configure' },
  { href: '/admin/identity', label: '资格审核', capability: 'platform.identity.review' },
  { href: '/admin/tournaments', label: '赛事', capability: 'platform.configure' },
  { href: '/admin/games', label: '项目', capability: 'platform.configure' },
  { href: '/admin/posts', label: '动态', capability: 'platform.configure' },
  { href: '/admin/photos', label: '素材', capability: 'platform.configure' },
  { href: '/admin/members', label: '成员', capability: 'platform.configure' },
  { href: '/admin/guestbook', label: '留言', capability: 'platform.configure' },
  { href: '/admin/settings', label: '设置', capability: 'platform.configure' },
] satisfies readonly {
  href: string
  label: string
  exact?: boolean
  capability: PlatformConsoleCapability
}[]

export function AdminNav({
  capabilities,
  hasTournamentWork,
}: {
  capabilities: readonly PlatformConsoleCapability[]
  hasTournamentWork: boolean
}) {
  const pathname = usePathname()
  const railRef = useRef<HTMLElement>(null)
  const links = LINKS.filter(
    link => capabilities.includes(link.capability) || (link.href === '/admin' && hasTournamentWork),
  )

  useEffect(() => {
    const active = railRef.current?.querySelector<HTMLElement>('[aria-current="page"]')
    active?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [pathname])

  return (
    <div className={styles.navViewport}>
      <nav ref={railRef} className={styles.nav} aria-label="后台导航">
        {links.map((link, index) => {
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
              <span>
                {link.href === '/admin' && !capabilities.includes('platform.configure')
                  ? '我的工作区'
                  : link.label}
              </span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

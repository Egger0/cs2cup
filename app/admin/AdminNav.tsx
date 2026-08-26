'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import styles from './admin.module.css'

const LINKS = [
  { href: '/admin', label: '报名与赛果', exact: true },
  { href: '/admin/tournaments', label: '赛事' },
  { href: '/admin/games', label: '项目' },
  { href: '/admin/posts', label: '动态' },
  { href: '/admin/photos', label: '素材' },
  { href: '/admin/members', label: '成员' },
]

export function AdminNav() {
  const pathname = usePathname()

  return (
    <nav className={styles.nav} aria-label="后台导航">
      {LINKS.map(link => {
        const active = link.exact ? pathname === link.href : pathname.startsWith(link.href)
        return (
          <Link
            key={link.href}
            href={link.href}
            className={active ? `${styles.navLink} ${styles.navActive}` : styles.navLink}
            aria-current={active ? 'page' : undefined}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}

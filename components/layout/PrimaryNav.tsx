'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { isCurrentPath, PRIMARY_LINKS } from '@/lib/site-navigation'
import styles from './PrimaryNav.module.css'

export function PrimaryNav({ hidden = false }: { hidden?: boolean }) {
  const pathname = usePathname()
  if (pathname.startsWith('/admin')) return null
  return (
    <nav
      className={styles.nav}
      aria-label="主导航"
      aria-hidden={hidden || undefined}
      inert={hidden}
    >
      {PRIMARY_LINKS.map(link => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={isCurrentPath(pathname, link.href) ? 'page' : undefined}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  )
}

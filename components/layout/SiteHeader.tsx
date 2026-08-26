'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Badge } from '@/components/ui'
import type { SiteSetting } from '@/lib/types'
import styles from './SiteHeader.module.css'

export interface NavLink {
  href: string
  label: string
}

export interface SiteHeaderProps {
  setting: SiteSetting
  links: NavLink[]
  status?: { label: string; open: boolean }
}

export function SiteHeader({ setting, links, status }: SiteHeaderProps) {
  const [open, setOpen] = useState(false)

  return (
    <header className={styles.header}>
      <div className={`wrap ${styles.inner}`}>
        <Link href="/" className={styles.brand}>
          <span className={styles.mark}>
            <Image
              src={setting.logoUrl ?? '/brand/club-logo.jpg'}
              alt=""
              width={72}
              height={72}
              priority
            />
          </span>
          <span className={styles.names}>
            <span>{setting.clubName}</span>
            <small className={styles.school}>
              {setting.clubNameEn ?? setting.school}
            </small>
          </span>
        </Link>

        <nav
          id="site-nav"
          className={open ? `${styles.nav} ${styles.navOpen}` : styles.nav}
          aria-label="站点导航"
        >
          {links.map(link => (
            <Link key={link.href} href={link.href} onClick={() => setOpen(false)}>
              {link.label}
            </Link>
          ))}
        </nav>

        <div className={styles.actions}>
          {status ? (
            <Badge tone={status.open ? 'ct' : 'neutral'} dot>
              {status.label}
            </Badge>
          ) : null}
          <button
            type="button"
            className={styles.toggle}
            aria-controls="site-nav"
            aria-expanded={open}
            aria-label={open ? '关闭导航' : '打开导航'}
            onClick={() => setOpen(value => !value)}
          >
            ☰
          </button>
        </div>
      </div>
    </header>
  )
}

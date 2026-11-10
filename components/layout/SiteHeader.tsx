'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { HomeMotionControl } from '@/components/home/HomeMotionControl'
import type { SiteSetting } from '@/lib/types'
import { AccountPortal } from './AccountPortal'
import { SiteHeaderFallback, type SiteNavLink } from './SiteHeaderFallback'
import styles from './SiteHeader.module.css'
import { HeaderSearch } from './HeaderSearch'
import { PrimaryNav } from './PrimaryNav'
import { StarMap } from './StarMap'
import { TabBar } from './TabBar'

export interface SiteHeaderProps {
  setting: SiteSetting
  links: SiteNavLink[]
  accountLink: SiteNavLink & { code: string }
}

export function SiteHeader({ setting, links, accountLink }: SiteHeaderProps) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [origin, setOrigin] = useState('100% 0')
  const [clientReady, setClientReady] = useState(false)
  const brandRef = useRef<HTMLAnchorElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  const menuRef = useRef<HTMLElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const brandName = setting.clubName === '宁波理工电竞社' ? '宁理电竞社' : setting.clubName
  const usesDefaultMark = !setting.logoUrl || setting.logoUrl === '/brand/club-logo.jpg'
  const active = links.reduce((best, link, index) => {
    const target = link.href.split('#', 1)[0]!
    const hit = link.href.includes('#')
      ? pathname === target
      : pathname === target || pathname.startsWith(`${target}/`)
    return hit && (best < 0 || link.href.length > links[best]!.href.length) ? index : best
  }, -1)

  useEffect(() => {
    let alive = true
    Promise.resolve().then(() => {
      if (alive) setClientReady(true)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let last = window.scrollY
    const root = document.documentElement
    const update = () => {
      const y = window.scrollY
      const down = y > last + 6 && y > 120
      const up = y < last - 6 || y < 24
      if (down && !headerRef.current?.contains(document.activeElement))
        root.dataset.headerHidden = ''
      else if (up) delete root.dataset.headerHidden
      if (down || up) last = y
    }
    window.addEventListener('scroll', update, { passive: true })
    return () => {
      window.removeEventListener('scroll', update)
      delete root.dataset.headerHidden
    }
  }, [])

  useEffect(() => {
    const close = () => setOpen(false)
    window.addEventListener('popstate', close)
    return () => window.removeEventListener('popstate', close)
  }, [])

  useEffect(() => {
    if (!open) return

    const inertTargets = document.querySelectorAll<HTMLElement>('main, footer, .skip')
    const previousOverflow = document.documentElement.style.overflow
    inertTargets.forEach(element => {
      element.inert = true
    })
    document.documentElement.style.overflow = 'hidden'

    const focusTimer = window.setTimeout(
      () => menuRef.current?.querySelectorAll('a')[Math.max(0, active)]?.focus(),
      80,
    )
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        requestAnimationFrame(() => triggerRef.current?.focus())
        return
      }
      if (event.key !== 'Tab') return

      const first = brandRef.current
      const last = [...(menuRef.current?.querySelectorAll('a') ?? [])].at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', handleKeyDown)
      document.documentElement.style.overflow = previousOverflow
      inertTargets.forEach(element => {
        element.inert = false
      })
    }
  }, [open, active])

  const toggle = (trigger: HTMLElement | null = toggleRef.current) => {
    triggerRef.current = trigger
    const box = trigger?.getBoundingClientRect()
    if (box)
      setOrigin(
        `${Math.round(box.left + box.width / 2)}px ${Math.round(box.top + box.height / 2)}px`,
      )
    setOpen(value => !value)
  }

  return (
    <header
      ref={headerRef}
      className={styles.dock}
      data-open={open || undefined}
      role={open ? 'dialog' : undefined}
      aria-modal={open ? 'true' : undefined}
      aria-label={open ? '全站目录' : undefined}
    >
      <div className={styles.inner} data-layout-container>
        <Link ref={brandRef} href="/" className={styles.brand} onClick={() => setOpen(false)}>
          <span className={styles.mark}>
            <Image
              src={usesDefaultMark ? '/brand/club-mark.svg' : setting.logoUrl!}
              alt=""
              width={72}
              height={72}
              className={usesDefaultMark ? styles.defaultMark : undefined}
              priority
            />
          </span>
          <span className={styles.names}>
            <span>{brandName}</span>
            <small className={styles.school}>{setting.clubNameEn ?? 'ESPORTS CLUB'}</small>
          </span>
        </Link>

        <div className={styles.actions}>
          {pathname === '/' && !open ? <HomeMotionControl /> : null}
          <PrimaryNav hidden={open} />
          <HeaderSearch hidden={open} />
          <AccountPortal href={accountLink.href} label={accountLink.label} hidden={open} />
          {clientReady ? (
            <button
              ref={toggleRef}
              type="button"
              className={`${styles.toggle} ${styles.menuToggle}`}
              aria-controls="site-menu"
              aria-expanded={open}
              aria-label={open ? '关闭全站目录' : '打开全站目录'}
              onClick={() => toggle()}
            >
              <span className={styles.menuIcon} aria-hidden="true">
                <i />
              </span>
              <span className={styles.toggleLabel}>{open ? '关闭' : '星图'}</span>
            </button>
          ) : (
            <SiteHeaderFallback links={links} />
          )}
        </div>
      </div>

      {clientReady ? <TabBar accountHref={accountLink.href} hidden={open} onMore={toggle} /> : null}

      <StarMap
        ref={menuRef}
        open={open}
        origin={origin}
        links={links}
        active={active}
        school={setting.school}
        onNavigate={() => setOpen(false)}
      />
    </header>
  )
}

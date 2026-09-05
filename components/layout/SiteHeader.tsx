'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Badge } from '@/components/ui'
import type { SiteSetting } from '@/lib/types'
import menuStyles from './SiteMenu.module.css'
import passStyles from './SitePassLink.module.css'
import { SiteHeaderFallback, type SiteNavLink } from './SiteHeaderFallback'
import styles from './SiteHeader.module.css'
import { HeaderSearch } from './HeaderSearch'

export interface SiteHeaderProps {
  setting: SiteSetting
  links: SiteNavLink[]
  accountLink: SiteNavLink & { code: string }
  status?: { label: string; open: boolean }
}

const PRIMARY_LINKS = new Set(['/tournaments', '/news', '/archive'])
const NAV_ENGLISH: Record<string, string> = {
  '/tournaments': 'TOURNAMENTS',
  '/news': 'JOURNAL',
  '/archive': 'ARCHIVE',
  '/games': 'GAMES',
  '/about': 'ABOUT',
  '/guestbook': 'GUESTBOOK',
  '/search': 'SEARCH',
  '/me': 'MY EVENTS',
  '/account#membership': 'QUALIFICATION',
  '/account/security': 'ACCOUNT & SECURITY',
  '/admin': 'WORKBENCH',
  '/login': 'LOGIN',
  '/register': 'CREATE ACCOUNT',
}

const DOCUMENT_LINKS = new Set(['/me', '/account#membership', '/account/security', '/admin'])

export function SiteHeader({ setting, links, accountLink, status }: SiteHeaderProps) {
  const pathname = usePathname()
  const isHome = pathname === '/'
  const [open, setOpen] = useState(false)
  const [homeTone, setHomeTone] = useState<'dark' | 'light'>('dark')
  const [clientReady, setClientReady] = useState(false)
  const brandRef = useRef<HTMLAnchorElement>(null)
  const menuFocusRef = useRef<HTMLAnchorElement>(null)
  const menuRef = useRef<HTMLElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const primaryLinks = links.filter(link => PRIMARY_LINKS.has(link.href))
  const brandName = setting.clubName === '宁波理工电竞社' ? '宁理电竞社' : setting.clubName
  const usesDefaultMark = !setting.logoUrl || setting.logoUrl === '/brand/club-logo.jpg'
  const logoSrc = usesDefaultMark ? '/brand/club-mark.svg' : setting.logoUrl!
  const [accountCodeLead, accountCodeTail] = accountLink.code.split(' / ', 2)

  const isActive = (href: string) => {
    const target = href.split('#', 1)[0]
    return href.includes('#')
      ? pathname === target
      : pathname === target || pathname.startsWith(`${target}/`)
  }
  const activeMenuIndex = links.findIndex(link => isActive(link.href))
  const focusMenuIndex = activeMenuIndex >= 0 ? activeMenuIndex : 0

  useEffect(() => {
    let active = true
    Promise.resolve().then(() => {
      if (active) setClientReady(true)
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!isHome) return

    let frame = 0
    const readTone = () => {
      frame = 0
      const headerHeight = window.innerWidth <= 900 ? 68 : 76
      const element = document.elementFromPoint(window.innerWidth / 2, headerHeight + 2)
      const section = element?.closest<HTMLElement>('[data-header-tone]')
      const tone = section?.dataset.headerTone
      if (tone === 'dark' || tone === 'light') setHomeTone(tone)
    }
    const scheduleRead = () => {
      if (frame) return
      frame = window.requestAnimationFrame(readTone)
    }

    frame = window.requestAnimationFrame(readTone)
    window.addEventListener('scroll', scheduleRead, { passive: true })
    window.addEventListener('resize', scheduleRead)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', scheduleRead)
      window.removeEventListener('resize', scheduleRead)
    }
  }, [isHome])

  useEffect(() => {
    const closeOnHistoryNavigation = () => setOpen(false)
    window.addEventListener('popstate', closeOnHistoryNavigation)
    return () => window.removeEventListener('popstate', closeOnHistoryNavigation)
  }, [])

  useEffect(() => {
    if (!open) return

    const inertTargets = document.querySelectorAll<HTMLElement>('main, footer, .skip')
    const previousOverflow = document.documentElement.style.overflow
    inertTargets.forEach(element => {
      element.inert = true
    })
    document.documentElement.style.overflow = 'hidden'

    const focusTimer = window.setTimeout(() => menuFocusRef.current?.focus(), 80)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        toggleRef.current?.focus()
        return
      }
      if (event.key !== 'Tab') return

      const menuLinks = Array.from(menuRef.current?.querySelectorAll<HTMLAnchorElement>('a') ?? [])
      const first = brandRef.current
      const last = menuLinks.at(-1)
      const active = document.activeElement
      if (!first || !last) return

      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
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
  }, [open])

  const headerClassName = [
    styles.header,
    isHome ? styles.homeHeader : '',
    isHome && homeTone === 'dark' ? styles.homeCoverHeader : '',
    isHome && homeTone === 'light' ? styles.homePageHeader : '',
    open ? styles.menuHeader : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <header
      className={headerClassName}
      role={open ? 'dialog' : undefined}
      aria-modal={open ? 'true' : undefined}
      aria-label={open ? '全站目录' : undefined}
    >
      <div className={styles.inner}>
        <Link ref={brandRef} href="/" className={styles.brand} onClick={() => setOpen(false)}>
          <span className={styles.mark}>
            <Image
              src={logoSrc}
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

        <nav
          className={styles.primaryNav}
          aria-label="主要导航"
          aria-hidden={open ? 'true' : undefined}
          inert={open ? true : undefined}
        >
          {primaryLinks.map((link, index) => {
            const active = isActive(link.href)
            return (
              <Link
                key={link.href}
                href={link.href}
                className={active ? styles.active : undefined}
                aria-current={active ? 'page' : undefined}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                {link.label}
              </Link>
            )
          })}
        </nav>

        <div className={styles.actions}>
          <HeaderSearch hidden={open} />
          {status ? (
            <Badge tone={status.open ? 'ct' : 'neutral'} dot>
              {status.label}
            </Badge>
          ) : null}
          <a
            href={accountLink.href}
            className={open ? `${passStyles.pass} ${passStyles.hidden}` : passStyles.pass}
            aria-hidden={open ? 'true' : undefined}
            tabIndex={open ? -1 : undefined}
          >
            <small className={passStyles.code} aria-hidden="true">
              <span>{accountCodeLead} / </span>
              {accountCodeTail}
            </small>
            <span className={passStyles.label}>{accountLink.label}</span>
          </a>
          {clientReady ? (
            <button
              ref={toggleRef}
              type="button"
              className={styles.toggle}
              aria-controls="site-menu"
              aria-expanded={open}
              aria-label={open ? '关闭全站目录' : '打开全站目录'}
              onClick={() => setOpen(value => !value)}
            >
              <span className={styles.toggleLabel}>{open ? '关闭' : '目录'}</span>
              <small>{String(links.length).padStart(2, '0')}</small>
              <span className={styles.menuIcon} aria-hidden="true">
                <i />
                <i />
              </span>
            </button>
          ) : (
            <SiteHeaderFallback links={links} />
          )}
        </div>
      </div>

      <div
        id="site-menu"
        className={open ? `${menuStyles.menu} ${menuStyles.menuOpen}` : menuStyles.menu}
        aria-hidden={!open}
        inert={!open}
      >
        <nav ref={menuRef} className={menuStyles.menuInner} aria-label="全部页面">
          <div className={menuStyles.menuMeta}>
            <span>INDEX / {String(links.length).padStart(2, '0')}</span>
            <span>{setting.school} · 2022—</span>
          </div>

          <ol className={menuStyles.menuList}>
            {links.map((link, index) => {
              const active = isActive(link.href)
              const content = (
                <>
                  <span className={menuStyles.number}>{String(index + 1).padStart(2, '0')}</span>
                  <span className={menuStyles.menuLabel}>
                    <strong>{link.label}</strong>
                    <small>{NAV_ENGLISH[link.href]}</small>
                  </span>
                  <span className={menuStyles.arrow} aria-hidden="true">
                    ↗
                  </span>
                </>
              )
              return (
                <li key={link.href}>
                  {DOCUMENT_LINKS.has(link.href) ? (
                    <a
                      ref={index === focusMenuIndex ? menuFocusRef : undefined}
                      href={link.href}
                      className={active ? menuStyles.active : undefined}
                      aria-current={active ? 'page' : undefined}
                      onClick={() => setOpen(false)}
                    >
                      {content}
                    </a>
                  ) : (
                    <Link
                      ref={index === focusMenuIndex ? menuFocusRef : undefined}
                      href={link.href}
                      className={active ? menuStyles.active : undefined}
                      aria-current={active ? 'page' : undefined}
                      onClick={() => setOpen(false)}
                    >
                      {content}
                    </Link>
                  )}
                </li>
              )
            })}
          </ol>

          <div className={menuStyles.menuFooter}>
            <span>NINGLI ESPORTS CLUB</span>
            <span>NB / CN</span>
          </div>
        </nav>
      </div>
    </header>
  )
}

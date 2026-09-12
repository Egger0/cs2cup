'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { MouseEvent } from 'react'
import { transitionTo } from './view-transition'
import './account-portal.css'
import styles from './AccountPortal.module.css'

export function TrophyGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7.2 3.6h9.6v4.2a4.8 4.8 0 0 1-9.6 0z" />
      <path d="M7.2 5.1H4.6a2.4 2.4 0 0 0 2.6 3.9" />
      <path d="M16.8 5.1h2.6a2.4 2.4 0 0 1-2.6 3.9" />
      <path d="M12 12.6v2.6" />
      <path d="M9.9 15.2h4.2l.8 3.1H9.1z" />
      <path d="M7.8 20.4h8.4" />
    </svg>
  )
}

export function AccountPortal({
  href,
  label,
  hidden = false,
}: {
  href: string
  label: string
  hidden?: boolean
}) {
  const router = useRouter()

  const enter = (event: MouseEvent<HTMLAnchorElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const x = box.left + box.width / 2
    const y = box.top + box.height / 2
    const root = document.documentElement
    root.style.setProperty('--portal-x', `${Math.round(x)}px`)
    root.style.setProperty('--portal-y', `${Math.round(y)}px`)
    root.style.setProperty(
      '--portal-reach',
      `${Math.ceil(Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)))}px`,
    )
    root.dataset.portal = ''
    const release = () => delete root.dataset.portal
    const transition = transitionTo(event, href, router.push)
    if (transition) void transition.finished.then(release, release)
    else release()
  }

  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className={hidden ? `${styles.portal} ${styles.hidden}` : styles.portal}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
      onClick={enter}
    >
      <TrophyGlyph />
    </Link>
  )
}

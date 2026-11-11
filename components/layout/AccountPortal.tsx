'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { MouseEvent } from 'react'
import { Icon } from '@/components/ui/Icon'
import { transitionTo } from './view-transition'
import './account-portal.css'
import styles from './AccountPortal.module.css'

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
      <Icon name="user" size={20} />
    </Link>
  )
}

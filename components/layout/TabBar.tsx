'use client'

import Link from 'next/link'
import type { CSSProperties } from 'react'
import { usePathname } from 'next/navigation'
import { Icon } from '@/components/ui/Icon'
import { ACCOUNT_PREFIXES, isCurrentPath } from '@/lib/site-navigation'
import styles from './TabBar.module.css'
import { UnreadBadge } from './UnreadBadge'

const TABS = [
  { href: '/', label: '首页', icon: 'home' },
  { href: '/tournaments', label: '赛事', icon: 'trophy' },
  { href: '/news', label: '动态', icon: 'news' },
] as const

export function TabBar({
  accountHref,
  hidden,
  onMore,
}: {
  accountHref: string
  hidden: boolean
  onMore: (button: HTMLButtonElement) => void
}) {
  const pathname = usePathname()
  const onAccount = ACCOUNT_PREFIXES.some(prefix => isCurrentPath(pathname, prefix))
  const current = (href: string) => (isCurrentPath(pathname, href) ? 'page' : undefined)
  const found = TABS.findIndex(tab => isCurrentPath(pathname, tab.href))
  const index = onAccount ? TABS.length : found
  return (
    <nav
      className={styles.bar}
      onClick={() => navigator.vibrate?.(8)}
      aria-label="底部导航"
      hidden={hidden}
      style={{ '--count': TABS.length + 2, '--index': Math.max(index, 0) } as CSSProperties}
    >
      <span className={styles.lens} data-visible={index >= 0 || undefined} aria-hidden="true" />
      {TABS.map(tab => (
        <Link key={tab.href} href={tab.href} aria-current={current(tab.href)}>
          <Icon name={tab.icon} size={22} />
          <span>{tab.label}</span>
        </Link>
      ))}
      <Link href={accountHref} aria-current={onAccount ? 'page' : undefined}>
        <Icon name="user" size={22} />
        <span>我的</span>
        <UnreadBadge enabled={accountHref === '/me'} />
      </Link>
      <button type="button" aria-haspopup="dialog" onClick={event => onMore(event.currentTarget)}>
        <Icon name="more" size={22} />
        <span>更多</span>
      </button>
    </nav>
  )
}

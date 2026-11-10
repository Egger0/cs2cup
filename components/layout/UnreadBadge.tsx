'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import styles from './UnreadBadge.module.css'

export function UnreadBadge({ enabled }: { enabled: boolean }) {
  const pathname = usePathname()
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    fetch('/api/notifications/unread', { cache: 'no-store', signal: controller.signal })
      .then(response => response.json() as Promise<{ unread: number }>)
      .then(body => setUnread(body.unread))
      .catch(() => {})
    return () => controller.abort()
  }, [enabled, pathname])

  if (!enabled || !unread) return null
  return (
    <span className={styles.badge} role="img" aria-label={`${unread} 条未读消息`}>
      {unread > 99 ? '99+' : unread}
    </span>
  )
}

import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AccountShell } from '@/components/account/AccountShell'
import { Button, Empty } from '@/components/ui'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { currentTimeMillis } from '@/lib/current-time'
import { formatSiteNumericDateTime } from '@/lib/datetime'
import { accountHasWorkAccess } from '@/lib/identity/account-security-state'
import { getAuthContext } from '@/lib/identity/kernel'
import { listNotifications } from '@/lib/notifications'
import { markAllNotificationsReadAction } from './actions'
import styles from './notifications.module.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '消息',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

export default async function NotificationsPage() {
  const context = await getAuthContext()
  if (context.kind === 'anonymous') redirect('/login?redirectKey=account')
  if (context.session.recoveryRestricted) redirect('/account/security?recovery=1')
  const database = cloudflareBindings().db
  const [items, workAccess] = await Promise.all([
    listNotifications(database, context.account.id),
    accountHasWorkAccess(database, context.account.id, currentTimeMillis()),
  ])
  const unread = items.some(item => item.unread)

  return (
    <AccountShell
      access={{ hasWorkAccess: workAccess, recoveryRestricted: false }}
      identity={context.account.displayName}
      title="与我有关"
    >
      {unread ? (
        <form action={markAllNotificationsReadAction} className={styles.bar}>
          <Button type="submit" variant="ghost">
            全部标为已读
          </Button>
        </form>
      ) : null}
      {items.length ? (
        <ol className={styles.list}>
          {items.map(item => (
            <li key={item.id} data-unread={item.unread || undefined}>
              <Link href={item.href}>
                <strong>{item.title}</strong>
                <span>{item.body}</span>
                <time dateTime={new Date(item.createdAt).toISOString()}>
                  {formatSiteNumericDateTime(item.createdAt)}
                </time>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <Empty>还没有消息。收到小队邀请或有人评论你的改枪码时会显示在这里。</Empty>
      )}
    </AccountShell>
  )
}

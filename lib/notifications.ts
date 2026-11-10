import 'server-only'

import type { IdentityDatabase } from './identity/internal/contracts.ts'

export const NOTIFICATION_PAGE_SIZE = 50
const UNREAD_COUNT_CAP = 99

export interface Notification {
  readonly id: number
  readonly title: string
  readonly body: string
  readonly href: string
  readonly createdAt: number
  readonly unread: boolean
}

export async function listNotifications(
  database: IdentityDatabase,
  accountId: string,
): Promise<Notification[]> {
  const { results } = await database
    .prepare(
      `SELECT id, title, body, href, created_at AS createdAt, read_at IS NULL AS unread
       FROM notification WHERE account_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(accountId, NOTIFICATION_PAGE_SIZE)
    .all<Omit<Notification, 'unread'> & { unread: number }>()
  return results.map(row => ({ ...row, unread: Boolean(row.unread) }))
}

export async function unreadNotificationCount(database: IdentityDatabase, accountId: string) {
  const row = await database
    .prepare(
      `SELECT COUNT(*) AS count FROM (
         SELECT 1 FROM notification WHERE account_id = ? AND read_at IS NULL LIMIT ?
       )`,
    )
    .bind(accountId, UNREAD_COUNT_CAP)
    .first<{ count: number }>()
  return Number(row?.count ?? 0)
}

export async function markNotificationsRead(
  database: IdentityDatabase,
  accountId: string,
  now: number,
) {
  await database
    .prepare('UPDATE notification SET read_at = ? WHERE account_id = ? AND read_at IS NULL')
    .bind(now, accountId)
    .run()
}

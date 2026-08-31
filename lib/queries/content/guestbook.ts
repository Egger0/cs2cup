import 'server-only'

import { requireAdmin } from '../../auth'
import { d1UtcTimestampToIso } from '../../datetime'
import {
  deletePrivateRows,
  insertPrivateRows,
  selectPrivateRows,
  updatePrivateRows,
} from '../../rdb'
import type { GuestbookMessage, GuestbookMessageStatus } from '../../types'
import { adminMutation } from './shared'

interface GuestbookRow {
  id: number
  name: string
  body: string
  parent_id: number | null
  is_official: boolean
  pinned: boolean
  status: GuestbookMessageStatus
  created_at: string
}

const toGuestbookMessage = (row: GuestbookRow): GuestbookMessage => ({
  id: row.id,
  name: row.name,
  body: row.body,
  parentId: row.parent_id,
  official: row.is_official,
  pinned: row.pinned,
  status: row.status,
  createdAt: d1UtcTimestampToIso(row.created_at) ?? row.created_at,
})

export async function adminListGuestbookMessages(): Promise<GuestbookMessage[]> {
  await requireAdmin()

  const rows = await selectPrivateRows<GuestbookRow>('guestbook_message', {
    order: 'created_at.desc,id.desc',
  })
  return rows.map(toGuestbookMessage)
}

export function adminSetGuestbookMessageStatus(id: number, status: GuestbookMessageStatus) {
  return adminMutation(() =>
    updatePrivateRows('guestbook_message', { status }, { filters: { id: `eq.${id}` } }),
  )
}

export function adminSetGuestbookMessagePinned(id: number, pinned: boolean) {
  return adminMutation(() =>
    updatePrivateRows('guestbook_message', { pinned }, { filters: { id: `eq.${id}` } }),
  )
}

export function adminCreateOfficialGuestbookReply(parentId: number, body: string) {
  return adminMutation(() =>
    insertPrivateRows('guestbook_message', {
      name: '宁波理工电竞社',
      body,
      parent_id: parentId,
      is_official: true,
      status: 'published',
    }),
  )
}

export function adminDeleteGuestbookMessage(id: number) {
  return adminMutation(() =>
    deletePrivateRows('guestbook_message', { filters: { id: `eq.${id}` } }),
  )
}

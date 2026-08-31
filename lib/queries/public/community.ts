import 'server-only'
import { d1UtcTimestampToIso } from '../../datetime'
import { selectPublicRows } from '../../rdb'
import type { ClubMember, GuestbookMessage } from '../../types'

interface MemberRow {
  id: number
  name: string
  role: string
  handle: string | null
  intro: string | null
  sort_order: number
}

interface GuestbookRow {
  id: number
  name: string
  body: string
  parent_id: number | null
  is_official: boolean
  pinned: boolean
  created_at: string
}

export async function listMembers(): Promise<ClubMember[]> {
  const rows = await selectPublicRows<MemberRow>('club_member', {
    order: 'sort_order.asc',
  })
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    role: row.role,
    handle: row.handle,
    intro: row.intro,
    sortOrder: row.sort_order,
  }))
}

export async function listGuestbookMessages(limit = 50): Promise<GuestbookMessage[]> {
  const rows = await selectPublicRows<GuestbookRow>('guestbook_public', {
    order: 'pinned.desc,created_at.desc,id.desc',
    limit,
  })
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    body: row.body,
    parentId: row.parent_id,
    official: row.is_official,
    pinned: row.pinned,
    status: 'published',
    createdAt: d1UtcTimestampToIso(row.created_at) ?? row.created_at,
  }))
}

import 'server-only'

import { requireAdmin } from '../../auth'
import {
  deletePrivateRows,
  insertPrivateRows,
  selectPrivateRows,
  updatePrivateRows,
} from '../../rdb'
import type { ClubMember } from '../../types'
import { adminMutation } from './shared'

interface MemberRow {
  id: number
  name: string
  role: string
  handle: string | null
  intro: string | null
  sort_order: number
}

export async function adminListMembers(): Promise<ClubMember[]> {
  await requireAdmin()

  const rows = await selectPrivateRows<MemberRow>('club_member', { order: 'sort_order.asc' })
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    role: row.role,
    handle: row.handle,
    intro: row.intro,
    sortOrder: row.sort_order,
  }))
}

export function adminCreateMember(values: Omit<ClubMember, 'id'>) {
  return adminMutation(() =>
    insertPrivateRows('club_member', {
      name: values.name,
      role: values.role,
      handle: values.handle,
      intro: values.intro,
      sort_order: values.sortOrder,
    }),
  )
}

export function adminSaveMember(id: number, values: Partial<ClubMember>) {
  const payload: Record<string, unknown> = {}
  if (values.name !== undefined) payload.name = values.name
  if (values.role !== undefined) payload.role = values.role
  if (values.handle !== undefined) payload.handle = values.handle
  if (values.intro !== undefined) payload.intro = values.intro
  if (values.sortOrder !== undefined) payload.sort_order = values.sortOrder
  return adminMutation(() =>
    updatePrivateRows('club_member', payload, { filters: { id: `eq.${id}` } }),
  )
}

export function adminDeleteMember(id: number) {
  return adminMutation(() => deletePrivateRows('club_member', { filters: { id: `eq.${id}` } }))
}

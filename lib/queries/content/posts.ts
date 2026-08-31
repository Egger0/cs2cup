import 'server-only'

import { requireAdmin } from '../../auth'
import {
  deletePrivateRows,
  insertPrivateRows,
  selectPrivateRows,
  updatePrivateRows,
} from '../../rdb'
import { type PostRow, toPost } from '../records'
import type { Post } from '../../types'
import { adminMutation } from './shared'

export async function adminListPosts(): Promise<Post[]> {
  await requireAdmin()

  const rows = await selectPrivateRows<PostRow>('post', {
    order: 'pinned.desc,published_at.desc',
  })
  return rows.map(toPost)
}

export function adminCreatePost(values: {
  slug: string
  title: string
  summary: string
  body: string
  gameId: number | null
  pinned: boolean
}) {
  return adminMutation(() =>
    insertPrivateRows('post', {
      slug: values.slug,
      title: values.title,
      summary: values.summary,
      body: values.body,
      game_id: values.gameId,
      pinned: values.pinned,
    }),
  )
}

export function adminSavePost(id: number, values: Partial<Post>) {
  const payload: Record<string, unknown> = {}
  if (values.title !== undefined) payload.title = values.title
  if (values.summary !== undefined) payload.summary = values.summary
  if (values.body !== undefined) payload.body = values.body
  if (values.gameId !== undefined) payload.game_id = values.gameId
  if (values.pinned !== undefined) payload.pinned = values.pinned
  return adminMutation(() => updatePrivateRows('post', payload, { filters: { id: `eq.${id}` } }))
}

export function adminDeletePost(id: number) {
  return adminMutation(() => deletePrivateRows('post', { filters: { id: `eq.${id}` } }))
}

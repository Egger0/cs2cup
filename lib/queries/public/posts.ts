import 'server-only'
import { selectPublicRow, selectPublicRows } from '../../rdb'
import type { Post } from '../../types'
import { type PostRow, toPost } from '../records'

export async function listPosts(limit?: number): Promise<Post[]> {
  const rows = await selectPublicRows<PostRow>('post', {
    order: 'pinned.desc,published_at.desc',
    limit,
  })
  return rows.map(toPost)
}

export async function getPost(slug: string): Promise<Post | null> {
  const row = await selectPublicRow<PostRow>('post', {
    filters: { slug: `eq.${slug}` },
  })
  return row ? toPost(row) : null
}

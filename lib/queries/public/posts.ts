import 'server-only'
import { selectPublicRow, selectPublicRows } from '../../rdb'
import type { Post } from '../../types'
import { type PostRow, toPost } from '../records'

export async function listPosts(
  limit?: number,
  order: 'pinned' | 'latest' = 'pinned',
): Promise<Post[]> {
  const rows = await selectPublicRows<PostRow>('post', {
    order: order === 'latest' ? 'published_at.desc' : 'pinned.desc,published_at.desc',
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

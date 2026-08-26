import Link from 'next/link'
import { Empty } from '@/components/ui'
import type { Post } from '@/lib/types'
import styles from './PostList.module.css'

export function PostList({ posts }: { posts: Post[] }) {
  if (posts.length === 0) return <Empty>还没有发布公告</Empty>

  return (
    <div className={styles.list}>
      {posts.map(post => (
        <Link key={post.id} href={`/news/${post.slug}`} className={styles.item}>
          <div className={styles.stamp}>
            <time dateTime={post.publishedAt}>
              {new Date(post.publishedAt).toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
              })}
            </time>
            {post.pinned ? <span className={styles.pin}>置顶</span> : null}
          </div>
          <div>
            <h3 className={styles.title}>{post.title}</h3>
            <p className={styles.summary}>{post.summary}</p>
            <p className={styles.more}>阅读全文 →</p>
          </div>
        </Link>
      ))}
    </div>
  )
}

import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PageMasthead } from '@/components/domain/Sections'
import { getPost, safely } from '@/lib/queries/public'
import styles from './post.module.css'

export const revalidate = 300

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const post = await safely(() => getPost(slug), null)
  if (!post) return { title: '动态' }
  return {
    title: post.title,
    description: post.summary,
    openGraph: { title: post.title, description: post.summary, type: 'article' },
  }
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await getPost(slug)
  if (!post) notFound()

  return (
    <article className="section">
      <div className="wrap">
        <div data-rise>
          <PageMasthead
            eyebrow={new Date(post.publishedAt).toLocaleDateString('zh-CN', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
            title={post.title}
            lede={post.summary}
            density="compact"
          />
        </div>
        <div className={styles.articleGrid}>
          <div className={styles.rail} aria-hidden="true">
            <span>ARTICLE</span>
            <span>{post.pinned ? 'PINNED' : 'PUBLIC'}</span>
          </div>
          <div className={styles.articleColumn}>
            <div className={styles.body}>
              {post.body
                .split('\n')
                .filter(Boolean)
                .map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
            </div>
            <p className={styles.back}>
              <Link href="/news" className="readout">
                ← 全部动态
              </Link>
            </p>
          </div>
        </div>
      </div>
    </article>
  )
}

import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SectionHead } from '@/components/domain/Sections'
import { getPost, listPosts, safely } from '@/lib/queries/public'
import styles from './post.module.css'

export const revalidate = 300

export async function generateStaticParams() {
  const posts = await safely(() => listPosts(), [])
  return posts.map(post => ({ slug: post.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const post = await safely(() => getPost(slug), null)
  if (!post) return { title: '动态 · 宁波理工电竞社' }
  return {
    title: `${post.title} · 宁波理工电竞社`,
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
          <SectionHead
            eyebrow={new Date(post.publishedAt).toLocaleDateString('zh-CN', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
            title={post.title}
            lede={post.summary}
          />
        </div>
        <div className={styles.body}>
          {post.body.split('\n').filter(Boolean).map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
        <p className={styles.back}>
          <Link href="/news" className="readout">
            ← 全部动态
          </Link>
        </p>
      </div>
    </article>
  )
}

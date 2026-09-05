import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PageMasthead } from '@/components/domain/Sections'
import { getPost, safely } from '@/lib/queries/public'
import { ShareButton } from '@/components/share/ShareButton'
import { resolveSiteOrigin } from '@/lib/site-config'
import { CLUB_BRAND } from '@/lib/brand'
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
    alternates: { canonical: `/news/${encodeURIComponent(slug)}` },
    openGraph: {
      title: post.title,
      description: post.summary,
      type: 'article',
      url: `/news/${encodeURIComponent(slug)}`,
      siteName: CLUB_BRAND.name,
      locale: 'zh_CN',
      publishedTime: post.publishedAt,
      images: [
        { url: '/opengraph-image.png', width: 1200, height: 630, alt: CLUB_BRAND.shortName },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.summary,
      images: ['/opengraph-image.png'],
    },
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
            <div className={styles.shareBar}>
              <span>{CLUB_BRAND.shortName} · 社团动态</span>
              <ShareButton
                share={{
                  title: post.title,
                  text: post.summary,
                  url: `${resolveSiteOrigin()}/news/${encodeURIComponent(slug)}`,
                  label: '社团动态 / JOURNAL',
                }}
              >
                分享这篇动态
              </ShareButton>
            </div>
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

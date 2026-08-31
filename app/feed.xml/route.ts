import { listPosts, safely } from '@/lib/queries/public'
import { resolveSiteOrigin } from '@/lib/site-config'

const BASE = resolveSiteOrigin()

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const revalidate = 900

export async function GET() {
  const posts = await safely(() => listPosts(30), [])

  const items = posts
    .map(post =>
      [
        '    <item>',
        `      <title>${escape(post.title)}</title>`,
        `      <link>${BASE}/news/${post.slug}</link>`,
        `      <guid isPermaLink="true">${BASE}/news/${post.slug}</guid>`,
        `      <pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate>`,
        `      <description>${escape(post.summary)}</description>`,
        '    </item>',
      ].join('\n'),
    )
    .join('\n')

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '  <channel>',
    '    <title>宁波理工电竞社</title>',
    `    <link>${BASE}</link>`,
    '    <description>浙大宁波理工学院电竞社的赛事与动态</description>',
    '    <language>zh-CN</language>',
    items,
    '  </channel>',
    '</rss>',
  ].join('\n')

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  })
}

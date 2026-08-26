import type { MetadataRoute } from 'next'

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://example.invalid'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/admin/'] }],
    sitemap: `${BASE}/sitemap.xml`,
  }
}

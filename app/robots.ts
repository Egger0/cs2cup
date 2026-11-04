import type { MetadataRoute } from 'next'
import { resolveSiteOrigin } from '@/lib/site-config'

const BASE = resolveSiteOrigin()

export const dynamic = 'force-dynamic'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin', '/api/', '/me', '/*/loadouts/random', '/*/loadouts?*'],
      },
      {
        userAgent: [
          'GPTBot',
          'ChatGPT-User',
          'CCBot',
          'ClaudeBot',
          'Bytespider',
          'PerplexityBot',
          'Amazonbot',
          'meta-externalagent',
        ],
        disallow: '/',
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
  }
}

import type { MetadataRoute } from 'next'
import { CLUB_BRAND } from '@/lib/brand'

// Metadata route revalidation must not write to the read-only OpenNext asset cache.
export const dynamic = 'force-dynamic'

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: CLUB_BRAND.name,
    short_name: CLUB_BRAND.shortName,
    description: CLUB_BRAND.description,
    lang: 'zh-CN',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f1efe8',
    theme_color: '#171817',
    icons: [
      { src: '/brand/app-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: '赛事大厅', url: '/tournaments' },
      { name: '我的赛事', url: '/me' },
      { name: '社团动态', url: '/news' },
    ],
  }
}

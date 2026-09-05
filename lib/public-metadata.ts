import type { Metadata } from 'next'
import { CLUB_BRAND } from './brand'

export function publicMetadata(title: string, description: string, path: string): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: `${title} · ${CLUB_BRAND.shortName}`,
      description,
      type: 'website',
      locale: 'zh_CN',
      siteName: CLUB_BRAND.name,
      url: path,
      images: [
        { url: '/opengraph-image.png', width: 1200, height: 630, alt: CLUB_BRAND.shortName },
      ],
    },
    twitter: { card: 'summary_large_image', title, description, images: ['/opengraph-image.png'] },
  }
}

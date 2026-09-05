import { CLUB_BRAND } from '@/lib/brand'
import { resolveSiteOrigin } from '@/lib/site-config'

export function SiteIdentity() {
  const origin = resolveSiteOrigin()
  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${origin}/#club`,
        name: CLUB_BRAND.name,
        alternateName: CLUB_BRAND.shortName,
        url: origin,
        logo: `${origin}/brand/app-icon-512.png`,
      },
      {
        '@type': 'WebSite',
        '@id': `${origin}/#website`,
        name: CLUB_BRAND.shortName,
        alternateName: CLUB_BRAND.name,
        url: origin,
        description: CLUB_BRAND.description,
        inLanguage: 'zh-CN',
        publisher: { '@id': `${origin}/#club` },
      },
    ],
  }
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  )
}

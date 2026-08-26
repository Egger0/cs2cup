import { notFound } from 'next/navigation'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { SiteHeader } from '@/components/layout/SiteHeader'
import { getSiteSetting, safely } from '@/lib/queries/public'

const LINKS = [
  { href: '/games', label: '项目' },
  { href: '/tournaments', label: '赛事' },
  { href: '/news', label: '动态' },
  { href: '/archive', label: '存档' },
  { href: '/about', label: '关于' },
  { href: '/search', label: '搜索' },
]

const FALLBACK_SETTING = {
  id: 1,
  clubName: '宁波理工电竞社',
  clubNameEn: null,
  school: '浙大宁波理工学院',
  logoUrl: null,
  contactQq: null,
  contactWechat: null,
  footerCopy: null,
}

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const setting = await safely(getSiteSetting, FALLBACK_SETTING)
  if (!setting) notFound()

  return (
    <>
      <SiteHeader setting={setting} links={LINKS} />
      <main id="main">{children}</main>
      <SiteFooter setting={setting} />
    </>
  )
}

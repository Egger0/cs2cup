import { notFound } from 'next/navigation'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { SiteHeader } from '@/components/layout/SiteHeader'
import { getSiteSetting, safely } from '@/lib/queries/public'

const LINKS = [
  { href: '/#register', label: '报名' },
  { href: '/#teams', label: '参赛战队' },
  { href: '/#bracket', label: '对阵赛程' },
  { href: '/#rules', label: '赛制规则' },
  { href: '/archive', label: '往届赛事' },
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
      <main>{children}</main>
      <SiteFooter setting={setting} />
    </>
  )
}

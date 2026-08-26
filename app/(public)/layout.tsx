import { notFound } from 'next/navigation'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { SiteHeader } from '@/components/layout/SiteHeader'
import { getSiteSetting, safely } from '@/lib/queries/public'

const LINKS = [
  { href: '/', label: '本届赛事' },
  { href: '/archive', label: '往届' },
  { href: '/club', label: '社团' },
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

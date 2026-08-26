import { notFound } from 'next/navigation'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { SiteHeader } from '@/components/layout/SiteHeader'
import { getSiteSetting } from '@/lib/queries/public'

const LINKS = [
  { href: '/#register', label: '报名' },
  { href: '/#teams', label: '参赛战队' },
  { href: '/#bracket', label: '对阵赛程' },
  { href: '/#rules', label: '赛制规则' },
  { href: '/archive', label: '往届赛事' },
]

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const setting = await getSiteSetting()
  if (!setting) notFound()

  return (
    <>
      <SiteHeader setting={setting} links={LINKS} />
      <main>{children}</main>
      <SiteFooter setting={setting} />
    </>
  )
}

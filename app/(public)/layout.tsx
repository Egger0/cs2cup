import { notFound } from 'next/navigation'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { SiteHeader } from '@/components/layout/SiteHeader'
import { getSiteSetting, safely } from '@/lib/queries/public'
import styles from './public-theme.module.css'

// Keep the shared HTML shell request-rendered without overriding explicit
// per-fetch public cache policies. `dynamic = 'force-dynamic'` would force
// every descendant fetch to no-store.
export const revalidate = 0

const LINKS = [
  { href: '/games', label: '项目' },
  { href: '/tournaments', label: '赛事' },
  { href: '/news', label: '动态' },
  { href: '/archive', label: '存档' },
  { href: '/about', label: '关于' },
  { href: '/guestbook', label: '留言' },
  { href: '/search', label: '搜索' },
]

const FALLBACK_SETTING = {
  id: 1,
  clubName: '宁波理工电竞社',
  clubNameEn: null,
  school: '浙大宁波理工学院',
  logoUrl: null,
  contactQq: '661543515',
  contactWechat: '无',
  footerCopy: null,
}

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const setting = await safely(getSiteSetting, FALLBACK_SETTING)
  if (!setting) notFound()

  return (
    <div className={styles.theme}>
      <SiteHeader setting={setting} links={LINKS} />
      <main id="main">{children}</main>
      <SiteFooter setting={setting} />
    </div>
  )
}

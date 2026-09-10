import { notFound } from 'next/navigation'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { SiteHeaderEntry } from '@/components/layout/SiteHeaderEntry'
import { SiteIdentity } from '@/components/layout/SiteIdentity'
import { accountHeaderLinks } from '@/lib/account-navigation'
import { currentAccountAccess } from '@/lib/identity/account-access'
import { FALLBACK_SITE_SETTING, getSiteSetting, safely } from '@/lib/queries/public'
import { PUBLIC_LINKS } from '@/lib/site-navigation'
import styles from '@/app/site-theme.module.css'

export const revalidate = 0

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const [setting, access] = await Promise.all([
    safely(getSiteSetting, FALLBACK_SITE_SETTING),
    currentAccountAccess(),
  ])
  if (!setting) notFound()

  const accountLink = access?.recoveryRestricted
    ? { href: '/account/security', label: '继续恢复', code: 'RECOVERY / CONTINUE' }
    : access
      ? { href: '/me', label: '我的赛事', code: 'MY / EVENTS' }
      : { href: '/login', label: '登录', code: 'ACCOUNT / LOGIN' }

  return (
    <div className={styles.theme}>
      <SiteIdentity />
      <SiteHeaderEntry
        setting={setting}
        links={[...PUBLIC_LINKS, ...accountHeaderLinks(access)]}
        accountLink={accountLink}
      />
      <main id="main">{children}</main>
      <SiteFooter setting={setting} />
    </div>
  )
}

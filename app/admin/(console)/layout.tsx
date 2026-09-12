import theme from '@/app/site-theme.module.css'
import { SiteHeaderEntry } from '@/components/layout/SiteHeaderEntry'
import { SiteIdentity } from '@/components/layout/SiteIdentity'
import { AccountSignOut } from '@/components/account/AccountSignOut'
import { requirePlatformConsole } from '@/lib/auth'
import { currentAccountAccess } from '@/lib/identity/account-access'
import { accountHeaderLinks } from '@/lib/account-navigation'
import { PUBLIC_LINKS } from '@/lib/site-navigation'
import { FALLBACK_SITE_SETTING, getSiteSetting, safely } from '@/lib/queries/public'
import { AdminNav } from './AdminNav'
import styles from './shell.module.css'

export const dynamic = 'force-dynamic'

export const metadata = { title: '后台管理' }

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const [admin, access, setting] = await Promise.all([
    requirePlatformConsole(),
    currentAccountAccess(),
    safely(getSiteSetting, FALLBACK_SITE_SETTING),
  ])
  const site = setting ?? FALLBACK_SITE_SETTING

  return (
    <div className={`${theme.dark} ${styles.shell}`}>
      <SiteIdentity />
      <SiteHeaderEntry
        setting={site}
        links={[...PUBLIC_LINKS, ...accountHeaderLinks(access)]}
        accountLink={{ href: '/me', label: '我的赛事', code: 'MY / EVENTS' }}
      />
      <div className={styles.sheet}>
        <AdminNav
          capabilities={admin.capabilities}
          hasTournamentWork={admin.hasTournamentWork}
          holdsReviewRole={admin.holdsReviewRole}
          trailing={
            <>
              <span className={styles.uid}>SESSION / {admin.uid}</span>
              <AccountSignOut />
            </>
          }
        />
        <main id="main" className={`wrap ${styles.main}`}>
          {children}
        </main>
      </div>
    </div>
  )
}

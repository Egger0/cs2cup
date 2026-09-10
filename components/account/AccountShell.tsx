import type { ReactNode } from 'react'
import themeStyles from '@/app/site-theme.module.css'
import { SectionTabs } from '@/components/layout/SectionTabs'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { SiteHeaderEntry } from '@/components/layout/SiteHeaderEntry'
import { SiteIdentity } from '@/components/layout/SiteIdentity'
import {
  accountHeaderLinks,
  accountSections,
  type AccountAccess,
  type AccountNavLink,
} from '@/lib/account-navigation'
import { PUBLIC_LINKS } from '@/lib/site-navigation'
import { FALLBACK_SITE_SETTING, getSiteSetting, safely } from '@/lib/queries/public'
import { AccountSignOut } from './AccountSignOut'
import styles from './AccountShell.module.css'

export async function AccountShell({
  access,
  identity,
  sections,
  signOut,
  children,
}: {
  access: AccountAccess | null
  identity: string
  sections?: AccountNavLink[]
  signOut?: ReactNode
  children: ReactNode
}) {
  const setting = await safely(getSiteSetting, FALLBACK_SITE_SETTING)
  const site = setting ?? FALLBACK_SITE_SETTING

  return (
    <div className={themeStyles.theme}>
      <SiteIdentity />
      <SiteHeaderEntry
        setting={site}
        links={[...PUBLIC_LINKS, ...accountHeaderLinks(access)]}
        accountLink={{ href: '/me', label: '我的赛事', code: 'MY / EVENTS' }}
      />
      <SectionTabs
        tabs={sections ?? (access ? accountSections(access) : [])}
        label="账号导航"
        trailing={
          <>
            <span className={styles.identity}>{identity}</span>
            {signOut ?? <AccountSignOut />}
          </>
        }
      />
      <main id="main" className={styles.main}>
        {children}
      </main>
      <SiteFooter setting={site} />
    </div>
  )
}

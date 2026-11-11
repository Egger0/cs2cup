import type { ReactNode } from 'react'
import themeStyles from '@/app/site-theme.module.css'
import { SectionTabs } from '@/components/layout/SectionTabs'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { SiteHeaderEntry } from '@/components/layout/SiteHeaderEntry'
import { SiteIdentity } from '@/components/layout/SiteIdentity'
import { accountSections, type AccountAccess, type AccountNavLink } from '@/lib/account-navigation'
import { siteMenuLinks } from '@/lib/site-menu'
import { FALLBACK_SITE_SETTING, getSiteSetting, safely } from '@/lib/queries/public'
import { AccountSignOut } from './AccountSignOut'
import styles from './AccountShell.module.css'

export async function AccountShell({
  access,
  identity,
  sections,
  signOut,
  title,
  lede,
  children,
}: {
  access: AccountAccess | null
  identity: string
  sections?: AccountNavLink[]
  signOut?: ReactNode
  title: string
  lede?: string
  children: ReactNode
}) {
  const setting = await safely(getSiteSetting, FALLBACK_SITE_SETTING)
  const site = setting ?? FALLBACK_SITE_SETTING

  return (
    <div className={themeStyles.theme}>
      <SiteIdentity />
      <SiteHeaderEntry
        setting={site}
        links={await siteMenuLinks(access)}
        accountLink={{ href: '/me', label: '我的赛事' }}
      />
      <header className={`${themeStyles.dark} ${styles.band}`} data-arrival>
        <div className={styles.bandInner}>
          <span className={styles.avatar} aria-hidden="true">
            {[...identity][0]}
          </span>
          <div className={styles.heading}>
            <h1>{title}</h1>
            <p>{lede ?? identity}</p>
          </div>
          <div className={styles.signOut}>{signOut ?? <AccountSignOut />}</div>
        </div>
      </header>
      <div className={styles.sheet}>
        <SectionTabs tabs={sections ?? (access ? accountSections(access) : [])} label="账号导航" />
        <main id="main" className={styles.main}>
          {children}
        </main>
      </div>
      <SiteFooter setting={site} />
    </div>
  )
}

import { ButtonLink } from '@/components/ui'
import { requirePlatformConsole } from '@/lib/auth'
import { AdminNav } from './AdminNav'
import { AccountSignOut } from '@/components/account/AccountSignOut'
import styles from './shell.module.css'
import theme from '@/app/site-theme.module.css'
import Image from 'next/image'
import { CLUB_BRAND } from '@/lib/brand'

export const dynamic = 'force-dynamic'

export const metadata = { title: '后台管理' }

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requirePlatformConsole()

  return (
    <div className={`${theme.dark} ${styles.shell}`}>
      <header className={styles.barFrame}>
        <div className={`wrap ${styles.bar}`}>
          <div className={styles.identity}>
            <span className={styles.monogram} aria-hidden="true">
              <Image src="/brand/club-mark.svg" alt="" width={28} height={28} priority />
            </span>
            <div>
              <div className={styles.eyebrow}>{CLUB_BRAND.name}</div>
              <div className={styles.title}>后台控制台</div>
              <div className={styles.uid}>SESSION / {admin.uid}</div>
            </div>
          </div>
          <div className={styles.barActions}>
            <ButtonLink href="/" size="mini">
              回到网站
            </ButtonLink>
            <AccountSignOut />
          </div>
        </div>
      </header>
      <div className={styles.navDock}>
        <div className="wrap">
          <AdminNav capabilities={admin.capabilities} hasTournamentWork={admin.hasTournamentWork} />
        </div>
      </div>
      <main id="main" className={`wrap ${styles.main}`}>
        {children}
      </main>
    </div>
  )
}

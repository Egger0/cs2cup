import { Button, ButtonLink } from '@/components/ui'
import { requireAdmin } from '@/lib/auth'
import { AdminNav } from './AdminNav'
import { signOut } from './actions/auth'
import styles from './shell.module.css'

export const dynamic = 'force-dynamic'

export const metadata = { title: '后台管理' }

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin()

  return (
    <div className={styles.shell}>
      <header className={styles.barFrame}>
        <div className={`wrap ${styles.bar}`}>
          <div className={styles.identity}>
            <span className={styles.monogram} aria-hidden="true">
              N
            </span>
            <div>
              <div className={styles.eyebrow}>NINGBOTECH ESPORTS / CONTROL ROOM</div>
              <div className={styles.title}>后台控制台</div>
              <div className={styles.uid}>SESSION / {admin.uid}</div>
            </div>
          </div>
          <div className={styles.barActions}>
            <ButtonLink href="/" size="mini">
              回到网站
            </ButtonLink>
            <form action={signOut}>
              <Button type="submit" size="mini">
                退出
              </Button>
            </form>
          </div>
        </div>
      </header>
      <div className={styles.navDock}>
        <div className="wrap">
          <AdminNav />
        </div>
      </div>
      <main id="main" className={`wrap ${styles.main}`}>
        {children}
      </main>
    </div>
  )
}

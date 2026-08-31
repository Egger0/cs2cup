import Link from 'next/link'
import { Button } from '@/components/ui'
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
      <header className={`wrap ${styles.bar}`}>
        <div>
          <div className={styles.title}>后台管理</div>
          <div className={styles.uid}>{admin.uid}</div>
        </div>
        <div className={styles.barActions}>
          <Link href="/">
            <Button size="mini">回到网站</Button>
          </Link>
          <form action={signOut}>
            <Button type="submit" size="mini">
              退出
            </Button>
          </form>
        </div>
      </header>
      <div className="wrap">
        <AdminNav />
      </div>
      <main id="main" className="wrap">
        {children}
      </main>
    </div>
  )
}

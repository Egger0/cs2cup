import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { Empty } from '@/components/ui'
import { requireAdmin } from '@/lib/auth'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { listPendingLoadoutCodes } from '@/lib/loadout-codes'
import { LoadoutReviewRow } from './LoadoutReviewRow'
import styles from '../admin.module.css'

export const dynamic = 'force-dynamic'

export default async function AdminLoadoutsPage() {
  await requireAdmin()
  const codes = await listPendingLoadoutCodes(cloudflareBindings().db)

  return (
    <>
      <AdminPageHeader
        index="11"
        title="改枪码审核"
        description="通过后署名展示在项目页；不通过的投稿只对投稿人可见。"
      />
      <section className={styles.panel}>
        <h2 className={styles.panelHead}>待审核 · {codes.length} 条</h2>
        {codes.length === 0 ? (
          <Empty>没有待审核的改枪码</Empty>
        ) : (
          <div className={styles.list}>
            {codes.map(code => (
              <LoadoutReviewRow key={code.id} code={code} />
            ))}
          </div>
        )}
      </section>
    </>
  )
}

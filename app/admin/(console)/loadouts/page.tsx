import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { Empty } from '@/components/ui'
import { requireAdmin } from '@/lib/auth'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { listLoadoutCodesForReview } from '@/lib/loadout-codes'
import { LoadoutReviewRow } from './LoadoutReviewRow'
import styles from '../admin.module.css'

export const dynamic = 'force-dynamic'

export default async function AdminLoadoutsPage() {
  await requireAdmin()
  const { pending, reported, shots } = await listLoadoutCodesForReview(cloudflareBindings().db)

  return (
    <>
      <AdminPageHeader
        index="11"
        title="改枪码审核"
        description="有截图的投稿请对照截图核对武器、模式和属性；通过后署名展示在项目页。"
      />
      <section className={styles.panel}>
        <h2 className={styles.panelHead}>待审核 · {pending.length} 条</h2>
        {pending.length === 0 ? (
          <Empty>没有待审核的改枪码</Empty>
        ) : (
          <div className={styles.list}>
            {pending.map(code => (
              <LoadoutReviewRow key={code.id} code={code} kind="pending" />
            ))}
          </div>
        )}
      </section>
      {shots.length ? (
        <section className={styles.panel}>
          <h2 className={styles.panelHead}>截图更新 · {shots.length} 条</h2>
          <div className={styles.list}>
            {shots.map(code => (
              <LoadoutReviewRow key={code.id} code={code} kind="shot" />
            ))}
          </div>
        </section>
      ) : null}
      {reported.length ? (
        <section className={styles.panel}>
          <h2 className={styles.panelHead}>失效反馈 · {reported.length} 条</h2>
          <div className={styles.list}>
            {reported.map(code => (
              <LoadoutReviewRow key={code.id} code={code} kind="reported" />
            ))}
          </div>
        </section>
      ) : null}
    </>
  )
}

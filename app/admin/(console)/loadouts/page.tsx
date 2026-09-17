import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { Empty } from '@/components/ui'
import { requireAdmin } from '@/lib/auth'
import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { listLoadoutCodesForReview } from '@/lib/loadout-codes'
import { formatSiteNumericDateTime } from '@/lib/datetime'
import { LoadoutReviewRow } from './LoadoutReviewRow'
import { OfficialSync } from './OfficialSync'
import styles from '../admin.module.css'

export const dynamic = 'force-dynamic'

export default async function AdminLoadoutsPage() {
  await requireAdmin()
  const db = cloudflareBindings().db
  const [{ pending, reported, shots }, official] = await Promise.all([
    listLoadoutCodesForReview(db),
    db
      .prepare(
        `SELECT COUNT(*) FILTER (WHERE status = 'approved') AS live, MAX(synced_at) AS syncedAt
         FROM loadout_code WHERE source = 'official'`,
      )
      .bind()
      .first<{ live: number; syncedAt: number | null }>(),
  ])

  return (
    <>
      <AdminPageHeader
        index="11"
        title="改枪码审核"
        description="有截图的投稿请对照截图核对武器、模式和属性；通过后署名展示在项目页。"
      />
      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <h2 className={styles.panelHead}>官方精选库 · {official?.live ?? 0} 套</h2>
          <OfficialSync />
        </div>
        <p className={styles.listMeta}>
          每天 03:30 自动从三角洲官方方案库同步渲染图、配件、属性和使用次数。
          {official?.syncedAt
            ? ` 上次同步：${formatSiteNumericDateTime(official.syncedAt)}`
            : ' 还没有同步过。'}
        </p>
      </section>
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

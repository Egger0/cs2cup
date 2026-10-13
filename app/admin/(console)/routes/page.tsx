import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { Empty } from '@/components/ui'
import { requireAdmin } from '@/lib/auth'
import { DELTA_MAPS } from '@/lib/delta-maps'
import { listSandPlans } from '@/lib/sand-route-store'
import { SandRouteRow } from './SandRouteRow'
import styles from '../admin.module.css'

export const dynamic = 'force-dynamic'

export default async function AdminRoutesPage() {
  await requireAdmin()
  const plans = await listSandPlans('all')
  const groups = [
    ['待审核', plans.filter(plan => !plan.approved), '没有待审核的路线'],
    ['已公开', plans.filter(plan => plan.approved), '还没有公开的路线'],
  ] as const

  return (
    <>
      <AdminPageHeader
        index="14"
        title="沙盘路线审核"
        description="先在沙盘里把路线走一遍，确认每站思路靠谱再通过。通过后署名出现在对应地图的社员路线里。"
      />
      {groups.map(([label, list, empty]) => (
        <section className={styles.panel} key={label}>
          <h2 className={styles.panelHead}>
            {label} · {list.length} 条
          </h2>
          {list.length === 0 ? (
            <Empty>{empty}</Empty>
          ) : (
            <div className={styles.list}>
              {list.map(plan => (
                <SandRouteRow
                  key={plan.id}
                  plan={plan}
                  mapName={DELTA_MAPS.find(map => map.id === plan.mapId)?.name ?? plan.mapId}
                />
              ))}
            </div>
          )}
        </section>
      ))}
    </>
  )
}

import { Empty } from '@/components/ui'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { requireAdmin } from '@/lib/auth'
import { listGraphicsPresets } from '@/lib/graphics-presets'
import { adminListGames } from '@/lib/queries/content'
import { GraphicsPresetForm } from './GraphicsPresetForm'
import { GraphicsPresetRow } from './GraphicsPresetRow'
import styles from '../admin.module.css'

export const dynamic = 'force-dynamic'

export default async function AdminGraphicsPage() {
  await requireAdmin()
  const [games, presets] = await Promise.all([adminListGames(), listGraphicsPresets()])

  return (
    <>
      <AdminPageHeader
        index="13"
        title="画质方案"
        description="录入各项目调校好的画质设置，保存后出现在对应项目的画质方案页。"
      />
      <section className={styles.panel}>
        <h2 className={styles.panelHead}>新增方案</h2>
        <GraphicsPresetForm games={games} />
      </section>
      <section className={styles.panel}>
        <h2 className={styles.panelHead}>全部方案 · {presets.length} 套</h2>
        {presets.length === 0 ? (
          <Empty>还没有画质方案</Empty>
        ) : (
          <div className={styles.list}>
            {presets.map(preset => (
              <GraphicsPresetRow key={preset.id} preset={preset} games={games} />
            ))}
          </div>
        )}
      </section>
    </>
  )
}

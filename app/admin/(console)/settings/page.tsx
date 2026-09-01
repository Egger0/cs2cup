import { Empty } from '@/components/ui'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { requireAdmin } from '@/lib/auth'
import { adminGetSiteSetting } from '@/lib/queries/content'
import { SettingsForm } from './SettingsForm'
import styles from '../admin.module.css'

export const dynamic = 'force-dynamic'

export default async function AdminSettingsPage() {
  await requireAdmin()

  const setting = await adminGetSiteSetting()

  return (
    <>
      <AdminPageHeader
        index="08"
        title="站点设置"
        description="维护社团身份、联系方式与页脚信息。"
      />
      <section className={styles.panel}>
        <h2 className={styles.panelHead}>基本信息</h2>
        {setting ? <SettingsForm setting={setting} /> : <Empty>还没有站点配置行</Empty>}
      </section>
    </>
  )
}

import { Empty } from '@/components/ui'
import { adminGetSiteSetting } from '@/lib/queries/content'
import { SettingsForm } from './SettingsForm'
import styles from '../admin.module.css'

export const dynamic = 'force-dynamic'

export default async function AdminSettingsPage() {
  const setting = await adminGetSiteSetting()

  return (
    <section className={styles.panel}>
      <h2 className={styles.panelHead}>站点设置</h2>
      {setting ? <SettingsForm setting={setting} /> : <Empty>还没有站点配置行</Empty>}
    </section>
  )
}

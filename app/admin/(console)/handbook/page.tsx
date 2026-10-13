import { Empty } from '@/components/ui'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { requireAdmin } from '@/lib/auth'
import { listHandbookDocuments } from '@/lib/handbook'
import { HandbookForm } from './HandbookForm'
import { HandbookRow } from './HandbookRow'
import styles from '../admin.module.css'

export const dynamic = 'force-dynamic'

export default async function AdminHandbookPage() {
  await requireAdmin()
  const documents = await listHandbookDocuments()

  return (
    <>
      <AdminPageHeader
        index="12"
        title="办赛文档"
        description="上传赛事手册和办赛模板，或者登记一个外部文档链接。保存后立即公开。"
      />
      <section className={styles.panel}>
        <h2 className={styles.panelHead}>添加文档</h2>
        <HandbookForm />
      </section>
      <section className={styles.panel}>
        <h2 className={styles.panelHead}>已公开 · {documents.length} 份</h2>
        {documents.length === 0 ? (
          <Empty>还没有办赛文档</Empty>
        ) : (
          <div className={styles.list}>
            {documents.map(document => (
              <HandbookRow key={document.id} document={document} />
            ))}
          </div>
        )}
      </section>
    </>
  )
}

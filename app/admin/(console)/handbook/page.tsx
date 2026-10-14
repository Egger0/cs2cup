import { Empty } from '@/components/ui'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { projectContentWorkspace } from '@/lib/project-content-access'
import { listHandbookDocuments } from '@/lib/handbook'
import { HandbookForm } from './HandbookForm'
import { HandbookRow } from './HandbookRow'
import styles from '../admin.module.css'

export const dynamic = 'force-dynamic'

export default async function AdminHandbookPage() {
  const { games, platformOwner } = await projectContentWorkspace()
  const gameIds = new Set(games.map(game => game.id))
  const documents = (await listHandbookDocuments()).filter(
    document => platformOwner || (document.gameId !== null && gameIds.has(document.gameId)),
  )

  return (
    <>
      <AdminPageHeader
        index="12"
        title="办赛文档"
        description="上传赛事手册和办赛模板，或者登记一个外部文档链接。保存后立即公开。"
      />
      <section className={styles.panel}>
        <h2 className={styles.panelHead}>添加文档</h2>
        <HandbookForm games={games} platformOwner={platformOwner} />
      </section>
      <section className={styles.panel}>
        <h2 className={styles.panelHead}>已公开 · {documents.length} 份</h2>
        {documents.length === 0 ? (
          <Empty>还没有办赛文档</Empty>
        ) : (
          <div className={styles.list}>
            {documents.map(document => (
              <HandbookRow
                key={document.id}
                document={document}
                projectName={
                  document.gameId === null
                    ? '社团通用'
                    : (games.find(game => game.id === document.gameId)?.name ?? '项目已删除')
                }
              />
            ))}
          </div>
        )}
      </section>
    </>
  )
}

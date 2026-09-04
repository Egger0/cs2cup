import { Empty } from '@/components/ui'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { requireAdmin } from '@/lib/auth'
import { adminListGuestbookMessages } from '@/lib/queries/content'
import { GuestbookRow } from './GuestbookRow'
import styles from '../admin.module.css'

export const dynamic = 'force-dynamic'

export default async function AdminGuestbookPage() {
  await requireAdmin()
  const messages = await adminListGuestbookMessages()

  return (
    <>
      <AdminPageHeader index="08" title="留言审核" description="处理公开状态、置顶与官方回复。" />
      <section className={styles.panel}>
        <h2 className={styles.panelHead}>留言管理 · {messages.length} 条</h2>
        {messages.length === 0 ? (
          <Empty>还没有访客留言</Empty>
        ) : (
          <div className={styles.list}>
            {messages.map(message => (
              <GuestbookRow key={message.id} message={message} />
            ))}
          </div>
        )}
      </section>
    </>
  )
}

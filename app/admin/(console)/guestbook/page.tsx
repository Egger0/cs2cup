import { Empty } from '@/components/ui'
import { requireAdmin } from '@/lib/auth'
import { adminListGuestbookMessages } from '@/lib/queries/content'
import { GuestbookRow } from './GuestbookRow'
import styles from '../admin.module.css'

export const dynamic = 'force-dynamic'

export default async function AdminGuestbookPage() {
  await requireAdmin()
  const messages = await adminListGuestbookMessages()

  return (
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
  )
}

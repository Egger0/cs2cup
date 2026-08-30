import { Empty } from '@/components/ui'
import { SectionHead } from '@/components/domain/Sections'
import { formatSiteNumericDate } from '@/lib/datetime'
import { listGuestbookMessages, safely } from '@/lib/queries/public'
import { GuestbookForm } from './GuestbookForm'
import styles from './guestbook.module.css'

export const dynamic = 'force-dynamic'

export const metadata = { title: '留言板 · 宁波理工电竞社' }

export default async function GuestbookPage() {
  const messages = await safely(() => listGuestbookMessages(), [])

  return (
    <section className="section">
      <div className="wrap">
        <SectionHead
          eyebrow="留言板"
          title="留下你的声音"
          lede="对赛事、社团或网站有什么想说的，都可以留在这里。"
        />

        <div className={styles.grid}>
          <div className={styles.submit}>
            <h2>写一条留言</h2>
            <GuestbookForm />
          </div>

          <div className={styles.messages}>
            <h2>大家在说</h2>
            {messages.length === 0 ? (
              <Empty>还没有公开留言，来写第一条吧。</Empty>
            ) : (
              <div className={styles.list}>
                {messages.map(message => (
                  <article key={message.id} className={styles.message}>
                    <header>
                      <strong>{message.name}</strong>
                      <time dateTime={message.createdAt}>
                        {formatSiteNumericDate(message.createdAt) ?? message.createdAt}
                      </time>
                    </header>
                    <p>{message.body}</p>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

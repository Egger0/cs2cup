import { Empty } from '@/components/ui'
import { SectionHead } from '@/components/domain/Sections'
import { formatSiteNumericDateTime } from '@/lib/datetime'
import { listGuestbookMessages, safely } from '@/lib/queries/public'
import { GuestbookForm } from './GuestbookForm'
import styles from './guestbook.module.css'

export const dynamic = 'force-dynamic'

export const metadata = { title: '留言板 · 宁波理工电竞社' }

export default async function GuestbookPage() {
  const messages = await safely(() => listGuestbookMessages(200), [])
  const roots = messages.filter(message => message.parentId === null)
  const repliesByParent = new Map<number, typeof messages>()
  for (const message of messages) {
    if (message.parentId === null) continue
    const replies = repliesByParent.get(message.parentId) ?? []
    replies.push(message)
    repliesByParent.set(message.parentId, replies)
  }

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
            {roots.length === 0 ? (
              <Empty>还没有公开留言，来写第一条吧。</Empty>
            ) : (
              <div className={styles.list}>
                {roots.map(message => (
                  <article key={message.id} className={styles.message}>
                    <header>
                      <strong>{message.name}</strong>
                      <time dateTime={message.createdAt}>
                        {formatSiteNumericDateTime(message.createdAt) ?? message.createdAt}
                      </time>
                    </header>
                    <p>{message.body}</p>
                    {(repliesByParent.get(message.id) ?? []).slice().reverse().map(reply => (
                      <article key={reply.id} className={styles.reply}>
                        <header>
                          <strong>
                            {reply.name}
                            {reply.official ? <span className={styles.official}>官方</span> : null}
                          </strong>
                          <time dateTime={reply.createdAt}>
                            {formatSiteNumericDateTime(reply.createdAt) ?? reply.createdAt}
                          </time>
                        </header>
                        <p>{reply.body}</p>
                      </article>
                    ))}
                    <details className={styles.replyComposer}>
                      <summary>回复</summary>
                      <GuestbookForm parentId={message.id} />
                    </details>
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

import Link from 'next/link'
import { formatSiteNumericDateTime } from '@/lib/datetime'
import type { PlatformAuditEvent } from '@/lib/identity/audit-log'
import styles from './operations.module.css'

export function AuditLog({
  events,
  total,
  page,
  previousHref,
  nextHref,
}: {
  events: readonly PlatformAuditEvent[]
  total: number
  page: number
  previousHref: string | null
  nextHref: string | null
}) {
  return (
    <section className={styles.audit} aria-labelledby="audit-title">
      <div className={styles.sectionHeading}>
        <div>
          <p>AUDIT / OPERATIONS</p>
          <h2 id="audit-title">操作记录</h2>
        </div>
        <span>{total} 条记录</span>
      </div>
      <div className={styles.auditList}>
        {events.map(event => (
          <article key={event.id}>
            <time>{formatSiteNumericDateTime(event.createdAt)}</time>
            <strong>{event.label}</strong>
            <span>
              {event.actor}
              {event.subject ? ` → ${event.subject}` : ''}
            </span>
            <small>{event.resource}</small>
            {event.reason ? (
              <small className={styles.auditReason}>原因：{event.reason}</small>
            ) : null}
          </article>
        ))}
      </div>
      {!events.length ? <p className={styles.listNote}>当前没有操作记录。</p> : null}
      {previousHref || nextHref ? (
        <nav className={styles.pagination} aria-label="操作记录分页">
          {previousHref ? <Link href={previousHref}>上一页</Link> : <span />}
          <span>第 {page} 页</span>
          {nextHref ? <Link href={nextHref}>下一页</Link> : <span />}
        </nav>
      ) : null}
    </section>
  )
}

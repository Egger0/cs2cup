import { redirect } from 'next/navigation'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { getAuthContext } from '@/lib/identity/kernel'
import { listMembershipReviewQueue } from '@/lib/identity/membership-service'
import { ReviewQueue } from './ReviewQueue'
import styles from './identity.module.css'

export const dynamic = 'force-dynamic'

export const metadata = { title: '资格审核 · 后台管理' }

export default async function IdentityReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string | string[] }>
}) {
  const [params, context] = await Promise.all([searchParams, getAuthContext()])
  if (context.kind === 'anonymous') redirect('/login?redirectKey=workspaces')
  const database = cloudflareBindings().db
  const clock = await database
    .prepare("SELECT unixepoch('now') * 1000 AS now")
    .bind()
    .first<{ now: number }>()
  const now = clock?.now ?? context.session.lastSeenAt
  const queue = await listMembershipReviewQueue(database, context, { now })
  if (!queue.ok) {
    if (queue.reason === 'reauthentication_required') {
      redirect('/login?redirectKey=workspaces&reauth=1')
    }
    if (queue.reason === 'session_invalid') redirect('/login?redirectKey=workspaces')
    redirect('/admin')
  }

  return (
    <div className={styles.page}>
      {params.welcome === '1' ? (
        <aside className={styles.welcome} role="status">
          <strong>统一管理员账号已启用</strong>
          <span>旧后台会话已经失效；今后使用普通账号登录入口。</span>
        </aside>
      ) : null}
      <header className={styles.heading}>
        <div>
          <p>IDENTITY / MEMBERSHIP REVIEW</p>
          <h1>成员资格审核</h1>
        </div>
        <dl>
          <div>
            <dt>待处理</dt>
            <dd>{queue.applications.length}</dd>
          </div>
          <div>
            <dt>已超 24h</dt>
            <dd>{queue.applications.filter(item => item.overdue).length}</dd>
          </div>
        </dl>
      </header>
      <p className={styles.guidance}>
        队列优先显示超过处理目标的申请。先领取，再决定；申请者等待期间仍可登录与维护账号。
      </p>
      <ReviewQueue
        applications={queue.applications}
        currentAccountId={context.account.id}
        now={now}
      />
    </div>
  )
}

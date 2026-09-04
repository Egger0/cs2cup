import { redirect } from 'next/navigation'

import { cloudflareBindings } from '@/lib/cloudflare-bindings'
import { currentTimeMillis } from '@/lib/current-time'
import { formatSiteNumericDateTime } from '@/lib/datetime'
import { listPlatformAuditEvents } from '@/lib/identity/audit-log'
import { getAuthContext } from '@/lib/identity/kernel'
import {
  listApprovedMemberships,
  listMembershipReviewQueue,
} from '@/lib/identity/membership-service'
import { listManagedRoleAssignments } from '@/lib/identity/role-management'
import { parsePageNumber } from '@/lib/pagination'
import { MembershipRoster } from './MembershipRoster'
import { AuditLog } from './AuditLog'
import { IdentityPagination } from './IdentityPagination'
import { ReviewerAccess } from './ReviewerAccess'
import { ReviewQueue } from './ReviewQueue'
import styles from './identity.module.css'

export const dynamic = 'force-dynamic'
export const metadata = { title: '资格审核 · 后台管理' }

const PAGE_SIZE = 20

interface IdentityPages {
  page: number
  membersPage: number
  rolesPage: number
  auditPage: number
}

function identityHref(pages: IdentityPages, key?: keyof IdentityPages, value?: number) {
  const next = key && value ? { ...pages, [key]: value } : pages
  const query = new URLSearchParams()
  for (const [name, page] of Object.entries(next)) {
    if (page > 1) query.set(name, String(page))
  }
  const serialized = query.toString()
  return serialized ? `/admin/identity?${serialized}` : '/admin/identity'
}

function waitTime(startedAt: number | null, now: number) {
  if (startedAt === null) return '—'
  const hours = Math.max(0, Math.floor((now - startedAt) / 3_600_000))
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export default async function IdentityReviewPage({
  searchParams,
}: {
  searchParams: Promise<{
    welcome?: string | string[]
    page?: string | string[]
    membersPage?: string | string[]
    rolesPage?: string | string[]
    auditPage?: string | string[]
  }>
}) {
  const [params, context] = await Promise.all([searchParams, getAuthContext()])
  if (context.kind === 'anonymous') redirect('/login?redirectKey=workspaces')
  const database = cloudflareBindings().db
  const now = currentTimeMillis()
  const requestedPages: IdentityPages = {
    page: parsePageNumber(params.page, PAGE_SIZE),
    membersPage: parsePageNumber(params.membersPage, PAGE_SIZE),
    rolesPage: parsePageNumber(params.rolesPage, PAGE_SIZE),
    auditPage: parsePageNumber(params.auditPage, PAGE_SIZE),
  }
  const [queue, roster, access, audit] = await Promise.all([
    listMembershipReviewQueue(database, context, {
      now,
      limit: PAGE_SIZE,
      offset: (requestedPages.page - 1) * PAGE_SIZE,
    }),
    listApprovedMemberships(database, context, {
      now,
      limit: PAGE_SIZE,
      offset: (requestedPages.membersPage - 1) * PAGE_SIZE,
    }),
    listManagedRoleAssignments(database, context, {
      now,
      limit: PAGE_SIZE,
      offset: (requestedPages.rolesPage - 1) * PAGE_SIZE,
    }),
    listPlatformAuditEvents(database, context, {
      now,
      limit: PAGE_SIZE,
      offset: (requestedPages.auditPage - 1) * PAGE_SIZE,
    }),
  ])
  if (!queue.ok || !roster.ok) {
    const reason = !queue.ok ? queue.reason : roster.reason
    if (reason === 'reauthentication_required') {
      redirect('/login?redirectKey=workspaces&reauth=1')
    }
    if (reason === 'session_invalid') redirect('/login?redirectKey=workspaces')
    redirect('/admin')
  }
  const totals: IdentityPages = {
    page: Math.max(1, Math.ceil(queue.summary.total / PAGE_SIZE)),
    membersPage: Math.max(1, Math.ceil(roster.total / PAGE_SIZE)),
    rolesPage: access.ok ? Math.max(1, Math.ceil(access.total / PAGE_SIZE)) : 1,
    auditPage: audit.ok ? Math.max(1, Math.ceil(audit.total / PAGE_SIZE)) : 1,
  }
  const pages: IdentityPages = {
    page: Math.min(requestedPages.page, totals.page),
    membersPage: Math.min(requestedPages.membersPage, totals.membersPage),
    rolesPage: access.ok ? Math.min(requestedPages.rolesPage, totals.rolesPage) : 1,
    auditPage: audit.ok ? Math.min(requestedPages.auditPage, totals.auditPage) : 1,
  }
  if (
    Object.keys(pages).some(
      key => pages[key as keyof IdentityPages] !== requestedPages[key as keyof IdentityPages],
    )
  ) {
    redirect(identityHref(pages))
  }

  return (
    <div className={styles.page}>
      {params.welcome === '1' ? (
        <aside className={styles.welcome} role="status">
          <strong>统一负责人账号已启用</strong>
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
            <dd>{queue.summary.total}</dd>
          </div>
          <div>
            <dt>最久等待</dt>
            <dd>{waitTime(queue.summary.oldestSubmittedAt, now)}</dd>
          </div>
          <div>
            <dt>已超 24h</dt>
            <dd>{queue.summary.overdue}</dd>
          </div>
          <div>
            <dt>截止风险</dt>
            <dd>{queue.summary.deadlineRisk}</dd>
          </div>
          <div>
            <dt>分配给我</dt>
            <dd>{queue.summary.assignedToMe}</dd>
          </div>
        </dl>
      </header>
      <p className={styles.guidance}>
        队列优先显示临近赛事截止和超过 24
        小时目标的申请。先领取，再决定；申请者等待期间仍可登录与维护账号。
        {queue.summary.nearestDeadlineAt
          ? ` 最近报名截止：${formatSiteNumericDateTime(queue.summary.nearestDeadlineAt)}。`
          : null}
      </p>
      <ReviewQueue
        applications={queue.applications}
        reviewers={queue.reviewers}
        currentAccountId={context.account.id}
        now={now}
      />
      <IdentityPagination
        label="审核队列分页"
        page={pages.page}
        pages={totals.page}
        previousHref={
          queue.pagination.hasPrevious ? identityHref(pages, 'page', pages.page - 1) : null
        }
        nextHref={queue.pagination.hasNext ? identityHref(pages, 'page', pages.page + 1) : null}
      />
      <MembershipRoster
        memberships={roster.memberships}
        total={roster.total}
        suspended={roster.suspended}
      />
      <IdentityPagination
        label="成员资格分页"
        page={pages.membersPage}
        pages={totals.membersPage}
        previousHref={
          roster.pagination.hasPrevious
            ? identityHref(pages, 'membersPage', pages.membersPage - 1)
            : null
        }
        nextHref={
          roster.pagination.hasNext
            ? identityHref(pages, 'membersPage', pages.membersPage + 1)
            : null
        }
      />
      {access.ok ? (
        <>
          <ReviewerAccess
            assignments={access.assignments}
            tournaments={access.tournaments}
            total={access.total}
          />
          <IdentityPagination
            label="人员权限分页"
            page={pages.rolesPage}
            pages={totals.rolesPage}
            previousHref={
              access.pagination.hasPrevious
                ? identityHref(pages, 'rolesPage', pages.rolesPage - 1)
                : null
            }
            nextHref={
              access.pagination.hasNext
                ? identityHref(pages, 'rolesPage', pages.rolesPage + 1)
                : null
            }
          />
        </>
      ) : null}
      {audit.ok ? (
        <AuditLog
          events={audit.events}
          total={audit.total}
          page={pages.auditPage}
          previousHref={
            audit.pagination.hasPrevious
              ? identityHref(pages, 'auditPage', pages.auditPage - 1)
              : null
          }
          nextHref={
            audit.pagination.hasNext ? identityHref(pages, 'auditPage', pages.auditPage + 1) : null
          }
        />
      ) : null}
    </div>
  )
}

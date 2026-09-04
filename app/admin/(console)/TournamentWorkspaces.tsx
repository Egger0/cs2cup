import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ButtonLink } from '@/components/ui'
import type { UnifiedTournamentWorkspace } from '@/lib/queries/staff-check-in'
import styles from './workspaces.module.css'

const ROLE_LABEL = {
  organizer: '赛事组织者',
  referee: '裁判',
  check_in_operator: '签到操作员',
}

export function TournamentWorkspaces({
  workspaces,
  canReviewIdentity,
  total,
  page,
  pages,
}: {
  workspaces: readonly UnifiedTournamentWorkspace[]
  canReviewIdentity: boolean
  total: number
  page: number
  pages: number
}) {
  return (
    <>
      <AdminPageHeader
        index="01"
        title="我的工作区"
        description="这里只显示当前账号被授予的赛事与首批可用操作入口。"
      />
      <p className={styles.scopeNote}>
        共 {total}{' '}
        个有效赛事工作区。现场签到已开放；赛果、赛程与赛事配置编辑页首版仍仅由平台负责人操作。
      </p>
      {canReviewIdentity ? (
        <aside className={styles.identityEntry}>
          <div>
            <strong>成员资格审核</strong>
            <span>处理等待中的成员资格申请。</span>
          </div>
          <ButtonLink href="/admin/identity" size="mini">
            进入审核台
          </ButtonLink>
        </aside>
      ) : null}
      <div className={styles.grid}>
        {workspaces.map(workspace => (
          <article key={workspace.id}>
            <p>
              {workspace.season} / EVENT {String(workspace.id).padStart(2, '0')}
            </p>
            <h2>{workspace.title}</h2>
            <div className={styles.roles}>
              {workspace.roles.map(role => (
                <span key={role}>{ROLE_LABEL[role]}</span>
              ))}
            </div>
            <div className={styles.capabilities}>
              {workspace.canCheckIn ? <span>签到读写</span> : null}
              {!workspace.canCheckIn ? <span>赛事查看</span> : null}
            </div>
            <footer>
              {workspace.canCheckIn ? (
                <ButtonLink href={`/admin/tournaments/${workspace.id}/check-in`} size="mini">
                  打开签到台
                </ButtonLink>
              ) : null}
              <ButtonLink href={`/tournaments/${workspace.slug}`} size="mini">
                查看赛事
              </ButtonLink>
            </footer>
          </article>
        ))}
      </div>
      {!workspaces.length ? <p className={styles.empty}>当前没有有效的赛事工作权限。</p> : null}
      {pages > 1 ? (
        <nav className={styles.pagination} aria-label="赛事工作区分页">
          {page > 1 ? (
            <ButtonLink
              href={page === 2 ? '/admin' : `/admin?workspacesPage=${page - 1}`}
              size="mini"
            >
              上一页
            </ButtonLink>
          ) : (
            <span />
          )}
          <span>
            第 {page} / {pages} 页
          </span>
          {page < pages ? (
            <ButtonLink href={`/admin?workspacesPage=${page + 1}`} size="mini">
              下一页
            </ButtonLink>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </>
  )
}

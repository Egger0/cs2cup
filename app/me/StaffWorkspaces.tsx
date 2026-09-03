import type { ParticipantCheckInWorkspace } from '@/lib/queries/staff-check-in'
import styles from './staff-workspaces.module.css'

const STATUS_LABEL = {
  draft: '筹备中',
  registration: '报名中',
  running: '进行中',
  finished: '已结束',
  postponed: '已延期',
} as const

export function StaffWorkspaces({ workspaces }: { workspaces: ParticipantCheckInWorkspace[] }) {
  if (!workspaces.length) return null

  return (
    <section className={styles.switcher} aria-labelledby="staff-workspaces-title">
      <header>
        <p>STAFF ACCESS / 工作权限</p>
        <h2 id="staff-workspaces-title">社团工作台</h2>
        <span>
          {workspaces.length === 1
            ? '你有一个可用的现场签到工作区。进入后仅可处理本届赛事现场签到。'
            : `你有 ${workspaces.length} 个可用的现场签到工作区。请选择本次值班赛事。`}
        </span>
      </header>
      <ul>
        {workspaces.map(workspace => (
          <li key={workspace.id}>
            {/* A full navigation keeps private operations out of the client route cache. */}
            <a href={`/admin/tournaments/${workspace.id}/check-in`}>
              <span className={styles.signal} aria-hidden="true" />
              <span className={styles.copy}>
                <small>
                  {workspace.season} · 第 {workspace.edition} 届 · {STATUS_LABEL[workspace.status]}
                </small>
                <strong>{workspace.title}</strong>
              </span>
              <span className={styles.action}>进入签到台&nbsp; ↗</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

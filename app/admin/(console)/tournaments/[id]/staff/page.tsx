import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ButtonLink } from '@/components/ui'
import { requireAdmin } from '@/lib/auth'
import { getTournamentCheckInOperatorManager } from '@/lib/queries/admin/tournament-staff'
import { CheckInOperatorManager } from './CheckInOperatorManager'
import styles from './staff.module.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '签到权限 · 后台管理',
  robots: { index: false, follow: false, nocache: true },
}

function tournamentIdFromParam(value: string) {
  if (!/^[1-9]\d*$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) ? id : null
}

export default async function TournamentStaffPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()
  const tournamentId = tournamentIdFromParam((await params).id)
  if (tournamentId === null) notFound()

  const manager = await getTournamentCheckInOperatorManager(tournamentId)
  if (!manager) notFound()

  return (
    <>
      <AdminPageHeader
        index="02.B"
        title="签到权限"
        description={`为「${manager.tournament.title}」临时开放现场签到；不授予后台管理权限。`}
      />

      <nav className={styles.contextNav} aria-label="赛事权限上下文">
        <div>
          <span>EVENT SCOPE / 单届赛事</span>
          <strong>
            {manager.tournament.season} · 第 {manager.tournament.edition} 届
          </strong>
        </div>
        <div className={styles.contextActions}>
          <ButtonLink href="/admin/identity#role-access-title" size="mini">
            管理统一账号权限
          </ButtonLink>
          <ButtonLink href={`/admin/tournaments/${tournamentId}/check-in`} size="mini">
            查看签到台
          </ButtonLink>
          <ButtonLink href={`/admin/tournaments/${tournamentId}`} size="mini">
            返回赛事设置
          </ButtonLink>
        </div>
      </nav>

      <section className={styles.boundary} aria-labelledby="permission-boundary-title">
        <header>
          <p>ROLE 01 / CHECK-IN OPERATOR</p>
          <h2 id="permission-boundary-title">只给当班所需的权限</h2>
        </header>
        <dl>
          <div>
            <dt>可处理</dt>
            <dd>查看本届已通过队伍，并确认或撤回现场签到。</dd>
          </div>
          <div>
            <dt>不可处理</dt>
            <dd>
              不能进入负责人后台，也看不到联系方式、备注、阵容与管理链接。组织者与平台负责人由其他职责授权，不在本页重复管理。
            </dd>
          </div>
          <div>
            <dt>有效期</dt>
            <dd>每次授权最长 7 天，到期自动失效；负责人可随时提前撤销。</dd>
          </div>
        </dl>
      </section>

      <CheckInOperatorManager manager={manager} />
    </>
  )
}

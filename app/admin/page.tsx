import { redirect } from 'next/navigation'
import { Badge, Button } from '@/components/ui'
import { getCurrentAdmin } from '@/lib/auth'
import { listAdminMatches, listTeamsWithContact } from '@/lib/queries/admin'
import { getCurrentTournament, getPublicTeams } from '@/lib/queries/public'
import { signOut } from './_actions'
import { ScheduleEditor } from './ScheduleEditor'
import { TeamTable } from './TeamTable'
import styles from './admin.module.css'

export const dynamic = 'force-dynamic'

export const metadata = { title: '后台管理 · 宁波理工电竞社' }

export default async function AdminPage() {
  const admin = await getCurrentAdmin().catch(() => null)
  if (!admin) redirect('/admin/login')

  const tournament = await getCurrentTournament()
  if (!tournament) {
    return (
      <main className={`wrap ${styles.shell}`}>
        <p>没有进行中的赛事。</p>
      </main>
    )
  }

  const [teams, matches, publicTeams] = await Promise.all([
    listTeamsWithContact(tournament.id),
    listAdminMatches(tournament.id),
    getPublicTeams(tournament.id),
  ])

  const pending = teams.filter(team => team.status === 'pending').length
  const approved = teams.filter(team => team.status === 'approved').length

  return (
    <main className={`wrap ${styles.shell}`}>
      <div className={styles.bar}>
        <div>
          <div className={styles.title}>{tournament.title}</div>
          <Badge tone="neutral">{admin.uid}</Badge>
        </div>
        <form action={signOut}>
          <Button type="submit" size="mini">
            退出登录
          </Button>
        </form>
      </div>

      <section className={styles.panel}>
        <h2 className={styles.panelHead}>
          报名审核 · 共 {teams.length} 支 · 待审核 {pending} · 已通过 {approved}/{tournament.teamCap}
        </h2>
        <TeamTable teams={teams} tournamentId={tournament.id} />
      </section>

      <section className={styles.panel}>
        <h2 className={styles.panelHead}>赛程与赛果</h2>
        <ScheduleEditor matches={matches} teams={publicTeams} tournamentId={tournament.id} />
      </section>
    </main>
  )
}

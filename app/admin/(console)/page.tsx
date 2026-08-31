import { requireAdmin } from '@/lib/auth'
import { listAdminMatches, listTeamsWithContact } from '@/lib/queries/admin'
import { getCurrentTournament, getPublicTeams } from '@/lib/queries/public'
import { ScheduleEditor } from './ScheduleEditor'
import { TeamTable } from './TeamTable'
import styles from './admin.module.css'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  await requireAdmin()

  const tournament = await getCurrentTournament()

  if (!tournament) {
    return (
      <section className={styles.panel}>
        <p>没有进行中的赛事。到「赛事」里新建一届，或把某一届的状态改为报名中。</p>
      </section>
    )
  }

  const [teams, matches, publicTeams] = await Promise.all([
    listTeamsWithContact(tournament.id),
    listAdminMatches(tournament.id),
    getPublicTeams(tournament.id),
  ])

  const pending = teams.filter(team => team.status === 'pending').length
  const approved = teams.filter(team => team.status === 'approved').length
  const checkedIn = teams.filter(team => team.checkedInAt).length

  return (
    <>
      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <h2 className={styles.panelHead}>
            报名审核 · 共 {teams.length} 支 · 待审核 {pending} · 已通过 {approved}/
            {tournament.teamCap} · 已签到 {checkedIn}
          </h2>
          <a
            className={styles.panelAction}
            href={`/admin/tournaments/${tournament.id}/teams.csv`}
            download
          >
            导出 CSV
          </a>
        </div>
        <TeamTable teams={teams} tournamentId={tournament.id} />
      </section>

      <section className={styles.panel}>
        <h2 className={styles.panelHead}>赛程与赛果</h2>
        <ScheduleEditor matches={matches} teams={publicTeams} tournamentId={tournament.id} />
      </section>
    </>
  )
}

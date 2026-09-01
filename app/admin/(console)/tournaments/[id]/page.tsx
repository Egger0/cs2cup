import { notFound } from 'next/navigation'
import { Empty } from '@/components/ui'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { requireAdmin } from '@/lib/auth'
import { adminListGames, adminListTournaments } from '@/lib/queries/content'
import { listAdminMatches, listTeamsWithContact } from '@/lib/queries/admin'
import { TournamentEditor } from './TournamentEditor'
import { BracketBuilder } from './BracketBuilder'
import { Scheduler } from './Scheduler'
import styles from '../../admin.module.css'

export const dynamic = 'force-dynamic'

export default async function AdminTournamentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()

  const { id } = await params
  const tournamentId = Number(id)
  if (!Number.isInteger(tournamentId)) notFound()

  const [tournaments, games] = await Promise.all([adminListTournaments(), adminListGames()])
  const tournament = tournaments.find(entry => entry.id === tournamentId)
  if (!tournament) notFound()

  const [teams, matches] = await Promise.all([
    listTeamsWithContact(tournamentId),
    listAdminMatches(tournamentId),
  ])

  const approved = teams.filter(team => team.status === 'approved')

  return (
    <>
      <AdminPageHeader
        index="02.A"
        title={tournament.title}
        description="维护公开信息、对阵结构与开赛时间；更改仅在明确保存或发布后生效。"
      />
      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <h2 className={styles.panelHead}>赛事设置</h2>
          <a
            className={styles.panelAction}
            href={`/admin/tournaments/${tournamentId}/teams.csv`}
            download
          >
            导出战队 CSV
          </a>
        </div>
        <TournamentEditor tournament={tournament} games={games} />
      </section>

      <section className={styles.panel}>
        <h2 className={styles.panelHead}>
          对阵表 · {matches.length} 场 · 已通过 {approved.length} 支
        </h2>
        {approved.length < 2 ? (
          <Empty>至少需要两支通过审核的战队才能抽签</Empty>
        ) : (
          <BracketBuilder
            tournamentId={tournamentId}
            approvedCount={approved.length}
            existingMatches={matches.length}
          />
        )}
      </section>

      {matches.length > 0 ? (
        <section className={styles.panel}>
          <h2 className={styles.panelHead}>赛程时间</h2>
          <Scheduler
            key={matches.map(match => `${match.id}:${match.scheduledAt ?? ''}`).join('|')}
            tournamentId={tournamentId}
            matches={matches}
            teams={teams}
          />
        </section>
      ) : null}
    </>
  )
}

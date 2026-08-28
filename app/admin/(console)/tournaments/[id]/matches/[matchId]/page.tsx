import Link from 'next/link'
import { notFound } from 'next/navigation'
import { indexMatches, indexTeams, resolveMatch } from '@/lib/bracket'
import { formatSiteDateTime } from '@/lib/datetime'
import { requireAdmin } from '@/lib/auth'
import { listAdminMatchMaps, listAdminMatches, listTeamsWithContact } from '@/lib/queries/admin'
import { adminListTournaments } from '@/lib/queries/content'
import { MatchReportEditor } from './MatchReportEditor'
import styles from './MatchReportEditor.module.css'

export const dynamic = 'force-dynamic'
export const metadata = { title: '编辑战报' }

export default async function AdminMatchReportPage({
  params,
}: {
  params: Promise<{ id: string; matchId: string }>
}) {
  await requireAdmin()

  const { id, matchId: rawMatchId } = await params
  const tournamentId = Number(id)
  const matchId = Number(rawMatchId)
  if (!Number.isInteger(tournamentId) || !Number.isInteger(matchId)) notFound()

  const [tournaments, matches, teams] = await Promise.all([
    adminListTournaments(),
    listAdminMatches(tournamentId),
    listTeamsWithContact(tournamentId),
  ])
  const tournament = tournaments.find(entry => entry.id === tournamentId)
  const match = matches.find(entry => entry.id === matchId && entry.tournamentId === tournamentId)
  if (!tournament || !match) notFound()

  const resolved = resolveMatch(match, indexMatches(matches), indexTeams(teams))
  const maps = await listAdminMatchMaps([match.id])
  return (
    <div className={styles.page}>
      <Link href="/admin" className={styles.back}>
        ← 返回报名与赛果
      </Link>

      <header className={styles.header}>
        <p className={styles.eyebrow}>
          {tournament.title} · {match.roundLabel} · BO{match.bestOf}
        </p>
        <h1 className={styles.title}>
          {resolved.a?.name ?? '待定'}
          <span>vs</span>
          {resolved.b?.name ?? '待定'}
        </h1>
        <p className={styles.meta}>
          {match.scheduledAt
            ? (formatSiteDateTime(match.scheduledAt) ?? '比赛时间待定')
            : '比赛时间待定'}
        </p>
      </header>

      {resolved.a && resolved.b ? (
        <MatchReportEditor
          matchId={match.id}
          tournamentId={tournament.id}
          bestOf={match.bestOf}
          mapPool={tournament.mapPool}
          initialMaps={maps}
          teamA={{ id: resolved.a.id, name: resolved.a.name, tag: resolved.a.tag }}
          teamB={{ id: resolved.b.id, name: resolved.b.name, tag: resolved.b.tag }}
        />
      ) : (
        <div className={styles.unavailable} role="status">
          <h2>双方尚未确定</h2>
          <p>等待上一轮赛果或轮空晋级处理完成后，再录入这场比赛的战报。</p>
        </div>
      )}
    </div>
  )
}

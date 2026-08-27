import { notFound } from 'next/navigation'
import { TournamentHeader } from '@/components/layout/TournamentHeader'
import { isByeMatch, isCompletedMatch } from '@/lib/bracket'
import { getMatches, getPublicTeams, getTournament } from '@/lib/queries/public'
import { buildScheduleEntries, selectNextScheduleEntry } from '@/lib/schedule'
import type { TournamentStatus } from '@/lib/types'

const STATUS_TEXT: Record<TournamentStatus, string> = {
  draft: '筹备中',
  registration: '报名开放中',
  running: '正在进行',
  finished: '已结束',
  postponed: '延期中',
}

export default async function TournamentLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const tournament = await getTournament(slug)
  if (!tournament) notFound()

  const [teams, matches] = await Promise.all([
    getPublicTeams(tournament.id),
    getMatches(tournament.id),
  ])

  const played = matches.filter(isCompletedMatch).length
  const playable = matches.filter(match => !isByeMatch(match)).length
  const next = selectNextScheduleEntry(buildScheduleEntries(matches, teams))
  const base = `/tournaments/${slug}`

  return (
    <>
      <TournamentHeader
        base={base}
        status={STATUS_TEXT[tournament.status]}
        eyebrow={tournament.heroEyebrow}
        title={tournament.heroBottom || tournament.title}
        game={tournament.gameName ?? ''}
        edition={tournament.edition}
        season={tournament.season}
        tagline={tournament.lede}
        seats={[teams.length, tournament.teamCap]}
        played={[played, playable]}
        maps={tournament.mapPool.length}
        next={
          next
            ? {
                id: next.match.id,
                roundLabel: next.match.roundLabel,
                bestOf: next.match.bestOf,
                scheduledAt: next.match.scheduledAt,
                aTag: next.a?.tag ?? 'TBD',
                aName: next.a?.name ?? '待定',
                bTag: next.b?.tag ?? 'TBD',
                bName: next.b?.name ?? '待定',
              }
            : null
        }
        tabs={[
          { href: base, label: '总览', exact: true },
          { href: `${base}/schedule`, label: '赛程' },
          { href: `${base}/teams`, label: '参赛战队', count: teams.length },
          { href: `${base}/bracket`, label: '对阵表' },
          { href: `${base}/results`, label: '战报', count: played },
          { href: `${base}/rules`, label: '赛制与须知' },
          { href: `${base}/register`, label: '报名' },
        ]}
      />
      {children}
    </>
  )
}

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { TournamentHeader } from '@/components/layout/TournamentHeader'
import { isByeMatch, isCompletedMatch } from '@/lib/bracket'
import {
  getMatches,
  getPublicTeams,
  getRegistrationStatus,
  getTournament,
  safely,
} from '@/lib/queries/public'
import { buildScheduleEntries, selectNextScheduleEntry } from '@/lib/schedule'
import type { TournamentStatus } from '@/lib/types'
import { resolveSiteOrigin } from '@/lib/site-config'
import { CLUB_BRAND } from '@/lib/brand'
import { formatSiteDateTime } from '@/lib/datetime'

const STATUS_TEXT: Record<TournamentStatus, string> = {
  draft: '筹备中',
  registration: '报名开放中',
  running: '正在进行',
  finished: '已结束',
  postponed: '延期中',
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const tournament = await safely(() => getTournament(slug), null)
  if (!tournament) return { title: '赛事' }

  return {
    title: {
      default: tournament.title,
      template: `%s · ${tournament.title} · 宁波理工电竞社`,
    },
    description: tournament.lede,
    openGraph: {
      title: `${tournament.title} · ${CLUB_BRAND.shortName}`,
      description: tournament.lede,
      url: `/tournaments/${encodeURIComponent(slug)}`,
      siteName: CLUB_BRAND.name,
      locale: 'zh_CN',
      type: 'website',
      images: [
        { url: '/opengraph-image.png', width: 1200, height: 630, alt: CLUB_BRAND.shortName },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: tournament.title,
      description: tournament.lede,
      images: ['/opengraph-image.png'],
    },
  }
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

  const [teams, matches, registration] = await Promise.all([
    getPublicTeams(tournament.id),
    getMatches(tournament.id),
    safely(() => getRegistrationStatus(slug), null),
  ])

  const played = matches.filter(isCompletedMatch).length
  const playable = matches.filter(match => !isByeMatch(match)).length
  const next = selectNextScheduleEntry(buildScheduleEntries(matches, teams))
  const base = `/tournaments/${slug}`
  const status = STATUS_TEXT[tournament.status]
  const eyebrow = tournament.heroEyebrow ? `${tournament.heroEyebrow} · ${status}` : status
  const seats: [number, number] = registration
    ? [registration.taken, registration.cap]
    : [teams.length, tournament.teamCap]

  return (
    <>
      <TournamentHeader
        tournamentId={tournament.id}
        share={{
          title: tournament.title,
          text: `${status} · ${tournament.gameName ?? '校园电竞'}。${tournament.regDeadline && tournament.status === 'registration' ? `报名截止：${formatSiteDateTime(tournament.regDeadline) ?? '以赛事页为准'}（北京时间）。` : tournament.lede}`,
          url: `${resolveSiteOrigin()}${base}`,
          label: `${tournament.season} / ${status}`,
        }}
        base={base}
        status={status}
        eyebrow={eyebrow}
        title={tournament.title}
        game={tournament.gameName ?? ''}
        edition={tournament.edition}
        season={tournament.season}
        tagline={tournament.lede}
        seats={seats}
        played={[played, playable]}
        deadline={formatSiteDateTime(tournament.regDeadline ?? '')}
        primaryAction={
          registration?.open
            ? { href: `${base}/register`, label: '组队报名' }
            : tournament.status === 'finished'
              ? { href: `${base}/results`, label: '查看战报' }
              : { href: `${base}/schedule`, label: '查看赛程' }
        }
        next={
          next && tournament.status !== 'registration'
            ? {
                id: next.match.id,
                roundLabel: next.match.roundLabel,
                bestOf: next.match.bestOf,
                scheduledAt: next.match.scheduledAt,
                aTag: next.a?.tag ?? 'TBD',
                aName: next.a?.name ?? '待定',
                bTag: next.b?.tag ?? 'TBD',
                bName: next.b?.name ?? '待定',
                status: next.status,
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

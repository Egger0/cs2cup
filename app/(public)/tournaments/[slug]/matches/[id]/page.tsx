import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SectionHead } from '@/components/domain/Sections'
import { MapVeto } from '@/components/domain/MapVeto'
import { Versus } from '@/components/domain/Versus'
import { indexMatches, indexTeams, isByeMatch, resolveMatch } from '@/lib/bracket'
import { formatSiteDateTime } from '@/lib/datetime'
import {
  getMatchMaps,
  getMatches,
  getPublicTeams,
  getTournament,
  safely,
} from '@/lib/queries/public'
import { buildScheduleEntries } from '@/lib/schedule'
import styles from './match.module.css'

export const revalidate = 300

function formatTournamentDateTime(value: string) {
  return formatSiteDateTime(value)?.replace(/^\d{4}年/, '') ?? null
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; id: string }>
}): Promise<Metadata> {
  const { slug, id } = await params
  const matchId = Number(id)
  if (!Number.isInteger(matchId)) return { title: '对阵详情' }

  const tournament = await safely(() => getTournament(slug), null)
  if (!tournament) return { title: '对阵详情' }
  const [teams, matches] = await Promise.all([
    safely(() => getPublicTeams(tournament.id), []),
    safely(() => getMatches(tournament.id), []),
  ])
  const match = matches.find(entry => entry.id === matchId)
  if (!match) return { title: '对阵详情' }

  const resolved = resolveMatch(match, indexMatches(matches), indexTeams(teams))
  if (isByeMatch(match)) {
    return { title: `${resolved.a?.name ?? resolved.b?.name ?? '参赛战队'} · 轮空` }
  }
  return {
    title: `${resolved.a?.name ?? '待定'} vs ${resolved.b?.name ?? '待定'}`,
  }
}

export default async function MatchPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>
}) {
  const { slug, id } = await params
  const matchId = Number(id)
  if (!Number.isInteger(matchId)) notFound()

  const tournament = await getTournament(slug)
  if (!tournament) notFound()

  const [teams, matches] = await Promise.all([
    getPublicTeams(tournament.id),
    getMatches(tournament.id),
  ])

  const match = matches.find(entry => entry.id === matchId)
  if (!match) notFound()

  const resolved = resolveMatch(match, indexMatches(matches), indexTeams(teams))
  const scheduleEntry = buildScheduleEntries(matches, teams).find(
    entry => entry.match.id === match.id,
  )
  const maps = await getMatchMaps([match.id])
  const bye = isByeMatch(match)
  const byeTeam = resolved.a ?? resolved.b

  return (
    <section className="section">
      <div className="wrap">
        <nav className={styles.breadcrumb} aria-label="当前位置">
          <Link href={`/tournaments/${slug}`}>赛事总览</Link>
          <span aria-hidden>/</span>
          <Link href={`/tournaments/${slug}/schedule`}>赛程</Link>
          <span aria-hidden>/</span>
          <span aria-current="page">{match.roundLabel}</span>
        </nav>

        <SectionHead
          eyebrow={`${tournament.season} · ${match.roundLabel}`}
          title={
            bye
              ? `${byeTeam?.name ?? '参赛战队'} · 轮空晋级`
              : `${resolved.a?.name ?? '待定'} vs ${resolved.b?.name ?? '待定'}`
          }
          lede={
            bye
              ? '自动晋级，无需安排比赛'
              : match.scheduledAt
                ? (formatTournamentDateTime(match.scheduledAt) ?? '时间待定')
                : '时间待定'
          }
        />

        <Versus match={match} a={resolved.a} b={resolved.b} status={scheduleEntry?.status} />

        {bye ? null : (
          <div className={styles.veto}>
            <MapVeto
              maps={maps}
              teamAName={resolved.a?.tag ?? 'A'}
              teamBName={resolved.b?.tag ?? 'B'}
            />
          </div>
        )}

        <nav className={styles.contextLinks} aria-label="继续浏览赛事">
          <Link href={`/tournaments/${slug}/schedule`}>
            <span aria-hidden>←</span> 查看赛程
          </Link>
          <Link href={`/tournaments/${slug}/bracket`}>
            查看对阵表 <span aria-hidden>→</span>
          </Link>
        </nav>
      </div>
    </section>
  )
}

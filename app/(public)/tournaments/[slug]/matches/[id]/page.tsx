import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SectionHead } from '@/components/domain/Sections'
import { MapVeto } from '@/components/domain/MapVeto'
import { Versus } from '@/components/domain/Versus'
import { indexMatches, indexTeams, resolveMatch } from '@/lib/bracket'
import { getMatchMaps, getMatches, getPublicTeams, getTournament } from '@/lib/queries/public'

export const revalidate = 300

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
  const maps = await getMatchMaps([match.id])

  const played = new Date(match.scheduledAt ?? '')

  return (
    <section className="section">
      <div className="wrap">
        <SectionHead
          eyebrow={`${tournament.season} · ${match.roundLabel}`}
          title={`${resolved.a?.name ?? '待定'} vs ${resolved.b?.name ?? '待定'}`}
          lede={
            match.scheduledAt
              ? played.toLocaleString('zh-CN', {
                  month: 'long',
                  day: 'numeric',
                  weekday: 'long',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '时间待定'
          }
        />

        <Versus match={match} a={resolved.a} b={resolved.b} />

        <div style={{ marginTop: 28 }}>
          <MapVeto
            maps={maps}
            teamAName={resolved.a?.tag ?? 'A'}
            teamBName={resolved.b?.tag ?? 'B'}
          />
        </div>

        <p style={{ marginTop: 28 }}>
          <Link href={`/tournaments/${slug}#bracket`} className="readout">
            ← 回到对阵表
          </Link>
        </p>
      </div>
    </section>
  )
}

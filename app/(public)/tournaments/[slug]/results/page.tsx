import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MapStats } from '@/components/domain/MapStats'
import { ResultsTable } from '@/components/domain/ResultsTable'
import { SectionHead } from '@/components/domain/Sections'
import { isCompletedMatch } from '@/lib/bracket'
import { mapStats } from '@/lib/mapstats'
import {
  getMatchMaps,
  getMatches,
  getPublicTeams,
  getTournament,
  safely,
} from '@/lib/queries/public'

export const revalidate = 300
export const metadata: Metadata = { title: '战报' }

export default async function ResultsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const tournament = await getTournament(slug)
  if (!tournament) notFound()

  const [teams, matches] = await Promise.all([
    getPublicTeams(tournament.id),
    getMatches(tournament.id),
  ])

  const decided = matches.filter(isCompletedMatch)
  const maps = await safely(() => getMatchMaps(decided.map(match => match.id)), [])
  const stats = mapStats(maps, tournament.mapPool).filter(stat => stat.total > 0)

  return (
    <section className="section">
      <div className="wrap">
        <div data-rise>
          <SectionHead
            eyebrow={`${decided.length} 场已完赛`}
            title="战报"
            lede="点开任意一场，可以看到完整的 Ban/Pick 过程与每张图的比分。"
          />
        </div>
        <div data-rise="2">
          <ResultsTable matches={matches} teams={teams} maps={maps} slug={slug} />
        </div>

        {stats.length > 0 ? (
          <div data-rise="3" style={{ marginTop: 56 }}>
            <SectionHead
              eyebrow="地图数据"
              title="哪张图最常打"
              lede="统计自每场比赛的 Ban/Pick 记录。"
            />
            <MapStats stats={stats} />
          </div>
        ) : null}
      </div>
    </section>
  )
}

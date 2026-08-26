import { notFound } from 'next/navigation'
import { ResultsTable } from '@/components/domain/ResultsTable'
import { SectionHead } from '@/components/domain/Sections'
import { getMatchMaps, getMatches, getPublicTeams, getTournament, safely } from '@/lib/queries/public'

export const revalidate = 300

export default async function ResultsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const tournament = await getTournament(slug)
  if (!tournament) notFound()

  const [teams, matches] = await Promise.all([
    getPublicTeams(tournament.id),
    getMatches(tournament.id),
  ])

  const decided = matches.filter(match => match.winnerTeamId !== null)
  const maps = await safely(() => getMatchMaps(decided.map(match => match.id)), [])

  return (
    <section className="section">
      <div className="wrap">
        <div data-rise>
          <SectionHead
            eyebrow={`${decided.length} 场已完赛`}
            title="战报"
            lede="点开任意一场,可以看到完整的 Ban/Pick 过程与每张图的比分。"
          />
        </div>
        <div data-rise="2">
          <ResultsTable matches={matches} teams={teams} maps={maps} slug={slug} />
        </div>
      </div>
    </section>
  )
}

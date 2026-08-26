import { notFound } from 'next/navigation'
import { Reveal } from '@/components/ui'
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
        <Reveal>
          <SectionHead
            eyebrow={`${decided.length} 场已完赛`}
            title="战报"
            lede="点开任意一场,可以看到完整的 Ban/Pick 过程与每张图的比分。"
          />
        </Reveal>
        <Reveal delay={60}>
          <ResultsTable matches={matches} teams={teams} maps={maps} slug={slug} />
        </Reveal>
      </div>
    </section>
  )
}

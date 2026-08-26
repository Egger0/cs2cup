import { notFound } from 'next/navigation'
import { Bracket } from '@/components/domain/Bracket'
import { SectionHead } from '@/components/domain/Sections'
import { winsNeeded } from '@/lib/bracket'
import { getMatches, getPublicTeams, getTournament } from '@/lib/queries/public'

export const revalidate = 300

export default async function BracketPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const tournament = await getTournament(slug)
  if (!tournament) notFound()

  const [teams, matches] = await Promise.all([
    getPublicTeams(tournament.id),
    getMatches(tournament.id),
  ])

  const opening = matches.find(match => match.round === 0)?.bestOf ?? 3

  return (
    <section className="section">
      <div className="wrap">
        <div data-rise>
          <SectionHead
            eyebrow="单败淘汰"
            title="对阵表"
            lede={`输一场即出局。每轮 BO${opening},胜者需要拿下 ${winsNeeded(opening)} 张图。点开任意一场看 Ban/Pick。`}
          />
        </div>
        <div data-rise="2">
          <Bracket matches={matches} teams={teams} slug={slug} />
        </div>
      </div>
    </section>
  )
}

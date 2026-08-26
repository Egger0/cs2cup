import { notFound } from 'next/navigation'
import { Reveal } from '@/components/ui'
import { SectionHead } from '@/components/domain/Sections'
import { TeamGrid } from '@/components/domain/TeamGrid'
import { getPublicTeams, getTournament } from '@/lib/queries/public'

export const revalidate = 300

export default async function TeamsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const tournament = await getTournament(slug)
  if (!tournament) notFound()

  const teams = await getPublicTeams(tournament.id)

  return (
    <section className="section">
      <div className="wrap">
        <Reveal>
          <SectionHead
            eyebrow={`${teams.length} / ${tournament.teamCap} 支`}
            title="参赛战队"
            lede="按报名先后排种子。种子号决定首轮对阵,高种子对低种子。"
          />
        </Reveal>
        <Reveal delay={60}>
          <TeamGrid teams={teams} />
        </Reveal>
      </div>
    </section>
  )
}

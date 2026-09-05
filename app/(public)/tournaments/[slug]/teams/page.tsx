import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SectionHead } from '@/components/domain/Sections'
import { TeamExplorer } from '@/components/discovery/TeamExplorer'
import { getPublicTeams, getTournament } from '@/lib/queries/public'

export const revalidate = 300
export const metadata: Metadata = { title: '参赛战队' }

export default async function TeamsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const tournament = await getTournament(slug)
  if (!tournament) notFound()

  const teams = await getPublicTeams(tournament.id)

  return (
    <section className="section">
      <div className="wrap">
        <div data-rise>
          <SectionHead
            eyebrow={`${teams.length} / ${tournament.teamCap} 支`}
            title="参赛战队"
            lede="找到你的队友，也认识下一位对手。点击战队可查看阵容、战绩和比赛日程。"
          />
        </div>
        <div data-rise="2">
          <TeamExplorer teams={teams} slug={slug} />
        </div>
      </div>
    </section>
  )
}

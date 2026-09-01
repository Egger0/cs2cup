import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Bracket } from '@/components/domain/Bracket'
import { SectionHead } from '@/components/domain/Sections'
import { winsNeeded } from '@/lib/bracket'
import { getMatches, getPublicTeams, getTournament } from '@/lib/queries/public'

export const revalidate = 300
export const metadata: Metadata = { title: '对阵表' }

function formatRoundStructure(matches: Awaited<ReturnType<typeof getMatches>>) {
  const rounds = new Map<number, { label: string; bestOf: number }>()
  for (const match of matches) {
    if (!rounds.has(match.round)) {
      rounds.set(match.round, { label: match.roundLabel, bestOf: match.bestOf })
    }
  }

  const formats = [...rounds.entries()].sort(([a], [b]) => a - b).map(([, round]) => round)
  const first = formats[0]
  if (!first) return '具体局制将在抽签后公布。'

  const sameBestOf = formats.every(round => round.bestOf === first.bestOf)
  if (sameBestOf) {
    const bestOf = first.bestOf
    return `全部轮次均为 BO${bestOf}，先赢 ${winsNeeded(bestOf)} 张图晋级。`
  }

  return `各轮局制：${formats.map(round => `${round.label} BO${round.bestOf}`).join('、')}。`
}

export default async function BracketPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const tournament = await getTournament(slug)
  if (!tournament) notFound()

  const [teams, matches] = await Promise.all([
    getPublicTeams(tournament.id),
    getMatches(tournament.id),
  ])

  const structure = formatRoundStructure(matches)

  return (
    <section className="section">
      <div className="wrap">
        <div data-rise>
          <SectionHead
            eyebrow="单败淘汰"
            title="对阵表"
            lede={`输一场即出局。${structure}点开任意一场查看 Ban/Pick。`}
          />
        </div>
        <div data-rise="2">
          <Bracket matches={matches} teams={teams} slug={slug} />
        </div>
      </div>
    </section>
  )
}

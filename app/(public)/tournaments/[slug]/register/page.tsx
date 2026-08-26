import { notFound } from 'next/navigation'
import { Reveal } from '@/components/ui'
import { SectionHead } from '@/components/domain/Sections'
import { getPublicTeams, getTournament } from '@/lib/queries/public'
import { RegisterForm } from './RegisterForm'

export const dynamic = 'force-dynamic'

export default async function RegisterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const tournament = await getTournament(slug)
  if (!tournament) notFound()

  const teams = await getPublicTeams(tournament.id)
  const seatsLeft = Math.max(0, tournament.teamCap - teams.length)

  return (
    <section className="section">
      <div className="wrap">
        <Reveal>
          <SectionHead
            eyebrow={seatsLeft > 0 ? `还剩 ${seatsLeft} 个席位` : '席位已满'}
            title="组队报名"
            lede="提交后由主办方审核。通过后战队会出现在参赛名单并进入对阵表。"
          />
        </Reveal>
        <Reveal delay={60}>
          <RegisterForm slug={slug} disabled={seatsLeft === 0} />
        </Reveal>
      </div>
    </section>
  )
}

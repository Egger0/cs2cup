import { notFound } from 'next/navigation'
import { Reveal } from '@/components/ui'
import { FaqList, RuleGrid, SectionHead } from '@/components/domain/Sections'
import { getTournament } from '@/lib/queries/public'

export const revalidate = 300

export default async function RulesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const tournament = await getTournament(slug)
  if (!tournament) notFound()

  return (
    <>
      <section className="section">
        <div className="wrap">
          <Reveal>
            <SectionHead eyebrow="赛制规则" title="开赛之前先读这些" />
          </Reveal>
          <Reveal delay={60}>
            <RuleGrid rules={tournament.rules} />
          </Reveal>
        </div>
      </section>

      <div className="divider" />

      <section className="section">
        <div className="wrap">
          <Reveal>
            <SectionHead eyebrow="须知" title="常见问题" />
          </Reveal>
          <Reveal delay={60}>
            <FaqList faqs={tournament.faqs} />
          </Reveal>
        </div>
      </section>
    </>
  )
}

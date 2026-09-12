import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { FaqList, RuleGrid, SectionHead } from '@/components/domain/Sections'
import { GhostStage } from '@/components/domain/GhostStage'
import { RuleGhost } from '@/components/domain/RuleGhost'
import { ButtonLink } from '@/components/ui'
import { getTournament } from '@/lib/queries/public'

export const revalidate = 300
export const metadata: Metadata = { title: '赛制与须知' }

export default async function RulesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const tournament = await getTournament(slug)
  if (!tournament) notFound()

  return (
    <>
      {tournament.rules.length ? (
        <section className="section">
          <div className="wrap">
            <div data-rise>
              <SectionHead eyebrow="赛制规则" title="开赛之前先读这些" />
            </div>
            <div data-rise="2">
              <RuleGrid rules={tournament.rules} />
            </div>
          </div>
        </section>
      ) : null}

      {tournament.rules.length && tournament.faqs.length ? <div className="divider" /> : null}

      {tournament.faqs.length ? (
        <section className="section">
          <div className="wrap">
            <div data-rise>
              <SectionHead eyebrow="须知" title="常见问题" />
            </div>
            <div data-rise="2">
              <FaqList faqs={tournament.faqs} />
            </div>
          </div>
        </section>
      ) : null}

      {tournament.rules.length || tournament.faqs.length ? null : (
        <section className="section">
          <div className="wrap">
            <div data-rise>
              <SectionHead eyebrow="赛制规则" title="开赛之前先读这些" />
            </div>
            <div data-rise="2">
              <GhostStage
                figure={<RuleGhost />}
                action={
                  <ButtonLink href={`/tournaments/${slug}/schedule`} size="mini">
                    看赛程
                  </ButtonLink>
                }
              >
                赛制与须知会在开赛前公布，公布后写在这里。
              </GhostStage>
            </div>
          </div>
        </section>
      )}
    </>
  )
}

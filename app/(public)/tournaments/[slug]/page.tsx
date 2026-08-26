import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui'
import { Countdown } from '@/components/domain/Countdown'
import { FaqList, RuleGrid, SectionHead, StatRow } from '@/components/domain/Sections'
import { TeamGrid } from '@/components/domain/TeamGrid'
import { indexTeams, nextPlayableMatch, winsNeeded } from '@/lib/bracket'
import { getMatches, getPublicTeams, getTournament, listTournaments } from '@/lib/queries/public'
import styles from './page.module.css'

export const revalidate = 300

export async function generateStaticParams() {
  const tournaments = await listTournaments()
  return tournaments.map(tournament => ({ slug: tournament.slug }))
}

export default async function TournamentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const tournament = await getTournament(slug)
  if (!tournament) notFound()

  const [teams, matches] = await Promise.all([
    getPublicTeams(tournament.id),
    getMatches(tournament.id),
  ])

  const next = nextPlayableMatch(matches, indexTeams(teams))
  const finalMatch = matches.reduce<number | null>(
    (best, match) => (best === null || match.round > best ? match.round : best),
    null,
  )
  const finalBestOf = matches.find(match => match.round === finalMatch)?.bestOf ?? 5

  return (
    <>
      <section className={`wrap ${styles.hero}`}>
        <div className={styles.heroGrid}>
          <div>
            <span className={styles.eyebrow}>{tournament.heroEyebrow || tournament.season}</span>
            <h1 className={styles.title}>
              <span>{tournament.heroTop}</span>
              <span className={styles.titleAccent}>{tournament.heroBottom}</span>
            </h1>
            <p className={styles.lede}>{tournament.lede}</p>
            <div className={styles.actions}>
              <Link href="#register">
                <Button variant="primary">立即报名参赛 →</Button>
              </Link>
              <Link href="#bracket">
                <Button>查看完整赛程</Button>
              </Link>
            </div>
          </div>
          <Countdown
            status={tournament.status}
            scheduledAt={next?.match.scheduledAt ?? null}
            label={`${tournament.heroBottom} · ${tournament.season}`}
            opponents={next ? `${next.a?.name ?? '待定'} vs ${next.b?.name ?? '待定'}` : '待定 vs 待定'}
          />
        </div>
      </section>

      <section className="wrap">
        <StatRow
          items={[
            { value: String(tournament.teamCap), unit: '支', key: '参赛席位' },
            { value: 'BO3', key: '淘汰赛赛制' },
            { value: String(tournament.mapPool.length), unit: '图', key: '现役地图池' },
            { value: `BO${finalBestOf}`, key: '总决赛赛制' },
          ]}
        />
      </section>

      <div className="divider" />

      <section id="teams" className="section">
        <div className="wrap">
          <SectionHead
            eyebrow="01 · 参赛战队"
            title={
              <>
                已确认战队{' '}
                <span style={{ color: 'var(--muted)' }}>
                  {teams.length}/{tournament.teamCap}
                </span>
              </>
            }
            lede="按报名先后种子排序。种子号决定首轮对阵——高种子对阵低种子。"
          />
          <TeamGrid teams={teams} />
        </div>
      </section>

      <div className="divider" />

      <section id="rules" className="section">
        <div className="wrap">
          <SectionHead
            eyebrow="02 · 赛制规则"
            title="开赛之前先读这些"
            lede={`每轮胜者需赢下 ${winsNeeded(3)} 张地图,总决赛为 BO${finalBestOf}。`}
          />
          <RuleGrid rules={tournament.rules} />
        </div>
      </section>

      <div className="divider" />

      <section id="faq" className="section">
        <div className="wrap">
          <SectionHead eyebrow="03 · 须知" title="常见问题" />
          <FaqList faqs={tournament.faqs} />
        </div>
      </section>
    </>
  )
}

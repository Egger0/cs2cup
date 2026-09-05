import type { Metadata } from 'next'
import { SectionHead } from '@/components/domain/Sections'
import { Honours } from '@/components/domain/Honours'
import { TournamentExplorer } from '@/components/discovery/TournamentExplorer'
import { ShareButton } from '@/components/share/ShareButton'
import { readTournamentFilters } from '@/lib/tournament-discovery'
import { resolveSiteOrigin } from '@/lib/site-config'
import styles from './tournaments.module.css'
import { listHonours, listTournaments, safely } from '@/lib/queries/public'

export const revalidate = 300

export const metadata: Metadata = {
  title: '赛事大厅',
  description: '发现宁理电竞校园赛事，按项目和赛季查找比赛，关注赛程，与队友一起报名上场。',
  alternates: { canonical: '/tournaments' },
}

export default async function TournamentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [tournaments, honours, query] = await Promise.all([
    safely(listTournaments, []),
    safely(listHonours, []),
    searchParams,
  ])
  const filters = readTournamentFilters(query)

  return (
    <section className={styles.page}>
      <div className="wrap">
        <header className={styles.masthead}>
          <div>
            <p className={styles.eyebrow}>NINGLI ESPORTS / TOURNAMENTS</p>
            <h1>
              赛事大厅<span>。</span>
            </h1>
            <p className={styles.lede}>找到下一场比赛，和队友一起为热爱上场。</p>
          </div>
          <div className={styles.aside}>
            <span className={styles.number}>{String(tournaments.length).padStart(2, '0')}</span>
            <span className={styles.caption}>场赛事 · 每一场都算数</span>
            <ShareButton
              share={{
                title: '和我一起，为宁理上场',
                text: '发现校园赛事、组队报名、关注赛程。宁理电竞社，等你加入。',
                url: `${resolveSiteOrigin()}/tournaments`,
                label: '校园电竞 / 赛事大厅',
              }}
            >
              分享赛事大厅
            </ShareButton>
          </div>
        </header>
        <TournamentExplorer
          key={JSON.stringify(filters)}
          tournaments={tournaments}
          initial={filters}
        />

        {honours.length > 0 ? (
          <div data-rise="2" style={{ marginTop: 72 }}>
            <SectionHead
              eyebrow="荣誉墙"
              title="历届冠军"
              lede="记住每一支走到最后的战队，也记住一起上场的日子。"
            />
            <Honours honours={honours} />
          </div>
        ) : null}
      </div>
    </section>
  )
}

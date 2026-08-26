import { SectionHead } from '@/components/domain/Sections'
import { TournamentList } from '@/components/domain/TournamentList'
import { listTournaments, safely } from '@/lib/queries/public'

export const revalidate = 300

export const metadata = { title: '赛事 · 宁波理工电竞社' }

export default async function TournamentsPage() {
  const tournaments = await safely(listTournaments, [])

  return (
    <section className="section">
      <div className="wrap">
        <div data-rise>
          <SectionHead
            eyebrow="赛事"
            title="全部赛事"
            lede="社团办过的所有比赛,按时间倒序。"
          />
        </div>
        <TournamentList tournaments={tournaments} />
      </div>
    </section>
  )
}

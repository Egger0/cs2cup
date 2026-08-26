import { SectionHead } from '@/components/domain/Sections'
import { Honours } from '@/components/domain/Honours'
import { TournamentList } from '@/components/domain/TournamentList'
import { listHonours, listTournaments, safely } from '@/lib/queries/public'

export const revalidate = 300

export const metadata = { title: '赛事 · 宁波理工电竞社' }

export default async function TournamentsPage() {
  const [tournaments, honours] = await Promise.all([
    safely(listTournaments, []),
    safely(listHonours, []),
  ])

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

        {honours.length > 0 ? (
          <div data-rise="2" style={{ marginTop: 72 }}>
            <SectionHead
              eyebrow="荣誉墙"
              title="历届冠军"
              lede="决赛胜者自动进入这里,往届可在后台补录。"
            />
            <Honours honours={honours} />
          </div>
        ) : null}
      </div>
    </section>
  )
}

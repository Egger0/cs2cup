import { SectionHead } from '@/components/domain/Sections'
import { PosterWall, type Edition } from '@/components/domain/PosterWall'
import { getPhotos, listTournaments, safely } from '@/lib/queries/public'

export const revalidate = 300

export const metadata = { title: '往届 · 宁波理工电竞社' }

export default async function ArchivePage() {
  const [tournaments, photos] = await Promise.all([
    safely(listTournaments, []),
    safely(() => getPhotos(), []),
  ])

  const editions: Edition[] = tournaments
    .filter(tournament => tournament.status === 'finished')
    .map(tournament => ({
      key: tournament.slug,
      year: tournament.season.replace(/[^0-9]/g, '') || String(tournament.edition),
      name: tournament.title,
      posters: photos.filter(photo => photo.tournamentId === tournament.id),
    }))
    .filter(edition => edition.posters.length > 0)

  return (
    <section className="section">
      <div className="wrap">
        <div data-rise>
          <SectionHead
            eyebrow="视觉档案"
            title="往届存档"
            lede="从 2022 年第一届起,每一届的海报、奖品和现场都留在这里。"
          />
        </div>
        <PosterWall editions={editions} />
      </div>
    </section>
  )
}

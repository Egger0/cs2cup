import { SectionHead } from '@/components/domain/Sections'
import { PhotoGrid, type PhotoGroup } from '@/components/domain/PhotoGrid'
import { getPhotos, listTournaments, safely } from '@/lib/queries/public'

export const revalidate = 300

export const metadata = {
  title: '往届赛事 · 宁波理工电竞社',
}

export default async function ArchivePage() {
  const [tournaments, photos] = await Promise.all([
    safely(listTournaments, []),
    safely(() => getPhotos(), []),
  ])

  const groups: PhotoGroup[] = tournaments
    .map(tournament => ({
      key: tournament.slug,
      title: `${tournament.season} · ${tournament.title}`,
      photos: photos.filter(photo => photo.tournamentId === tournament.id),
    }))
    .filter(group => group.photos.length > 0)

  return (
    <section className="section">
      <div className="wrap">
        <SectionHead
          eyebrow="往届赛事"
          title="历届宁理杯"
          lede="从第一届春季赛到今天,每一张照片都是一次开黑的现场。"
        />
        <PhotoGrid groups={groups} />
      </div>
    </section>
  )
}

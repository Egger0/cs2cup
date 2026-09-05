import { PageMasthead } from '@/components/domain/Sections'
import { ButtonLink, Empty } from '@/components/ui'
import { PosterWall, type Edition } from '@/components/domain/PosterWall'
import { getPhotos, listTournaments, safely } from '@/lib/queries/public'

export const revalidate = 300

export const metadata = { title: '往届' }

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
  const archivedCount = editions.filter(edition => edition.posters.length > 0).length

  return (
    <section className="section">
      <div className="wrap">
        <div data-rise>
          <PageMasthead
            eyebrow="视觉档案"
            title="往届存档"
            lede={
              archivedCount > 0
                ? `已归档 ${archivedCount} 届赛事的海报、奖品与现场影像。`
                : '赛事影像正在逐项核对，整理完成后会按赛季在这里归档。'
            }
            density="compact"
          />
        </div>
        {editions.length ? (
          <PosterWall editions={editions} />
        ) : (
          <Empty
            action={
              <ButtonLink href="/tournaments" variant="primary">
                看看正在发生的赛事
              </ButtonLink>
            }
          >
            档案整理中，第一批影像将在核对后公开。
          </Empty>
        )}
      </div>
    </section>
  )
}

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PosterWall } from '@/components/domain/PosterWall'
import { SectionHead } from '@/components/domain/Sections'
import { ButtonLink, Empty } from '@/components/ui'
import { getPhotos, getTournament, safely } from '@/lib/queries/public'

export const revalidate = 300
export const metadata: Metadata = { title: '素材' }

export default async function MediaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const tournament = await getTournament(slug)
  if (!tournament) notFound()
  const posters = await safely(() => getPhotos(tournament.id), [])

  return (
    <section className="section">
      <div className="wrap">
        <div data-rise>
          <SectionHead
            eyebrow={posters.length ? `${posters.length} 张影像` : '视觉档案'}
            title="素材"
            lede="本届的海报、奖品与现场影像，点开任意一张查看大图。"
          />
        </div>
        <div data-rise="2">
          {posters.length ? (
            <PosterWall
              editions={[{ key: tournament.slug, year: '', name: tournament.title, posters }]}
              bare
            />
          ) : (
            <Empty action={<ButtonLink href="/archive">看看往届存档</ButtonLink>}>
              本届影像正在核对与整理。
            </Empty>
          )}
        </div>
      </div>
    </section>
  )
}

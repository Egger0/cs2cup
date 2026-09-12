import Link from 'next/link'
import type { CSSProperties } from 'react'
import { Icon } from '@/components/ui/Icon'
import { photoUrl } from '@/lib/media'
import { variantStorageKey } from '@/lib/photo-variants'
import type { Photo, Tournament } from '@/lib/types'
import styles from './HomeWall.module.css'

const RATES = ['22vh', '-16vh', '10vh']

const sourceFor = (photo: Photo) =>
  photoUrl(
    photo.variantWidths.length
      ? variantStorageKey(photo.storageKey, photo.variantWidths.at(-1)!)
      : photo.storageKey,
  )
const sourceSetFor = (photo: Photo) =>
  photo.variantWidths.length
    ? photo.variantWidths
        .map(width => `${photoUrl(variantStorageKey(photo.storageKey, width))} ${width}w`)
        .join(', ')
    : undefined

export function HomeWall({ photos, tournaments }: { photos: Photo[]; tournaments: Tournament[] }) {
  if (photos.length < 3) return null
  const titles = new Map(tournaments.map(tournament => [tournament.id, tournament.title]))
  const columns: Photo[][] = [[], [], []]
  photos.slice(0, 12).forEach((photo, index) => columns[index % 3]!.push(photo))
  return (
    <section className={styles.wall} data-scene data-zone="wall" aria-labelledby="wall-title">
      <header className={styles.head}>
        <p>ARCHIVE / 往届现场</p>
        <h2 id="wall-title">每一届，都有人记得。</h2>
        <Link href="/archive">
          走进往届档案 <Icon name="arrow" size={16} />
        </Link>
      </header>
      <div className={styles.columns}>
        {columns.map((column, index) => (
          <div
            key={index}
            className={styles.column}
            style={{ '--rate': RATES[index] } as CSSProperties}
          >
            {column.map(photo => {
              const title = titles.get(photo.tournamentId) ?? 'NINGLI CUP'
              return (
                <figure key={photo.id} style={{ aspectRatio: `${photo.width} / ${photo.height}` }}>
                  <img
                    data-src={sourceFor(photo)}
                    data-srcset={sourceSetFor(photo)}
                    sizes="(max-width: 700px) 50vw, 32vw"
                    alt={photo.caption ?? `${title}现场`}
                    decoding="async"
                  />
                  <figcaption>
                    <span>{title}</span>
                    {photo.caption ? <span>{photo.caption}</span> : null}
                  </figcaption>
                </figure>
              )
            })}
          </div>
        ))}
      </div>
    </section>
  )
}

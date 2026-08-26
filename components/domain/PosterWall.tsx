'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { Button, Empty } from '@/components/ui'
import { photoUrl } from '@/lib/media'
import type { Photo } from '@/lib/types'
import styles from './PosterWall.module.css'

export interface Edition {
  key: string
  year: string
  name: string
  posters: Photo[]
}

export function PosterWall({ editions }: { editions: Edition[] }) {
  const [active, setActive] = useState<Photo | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (active && !dialog.open) dialog.showModal()
    if (!active && dialog.open) dialog.close()
  }, [active])

  if (editions.length === 0) return <Empty>还没有往届海报</Empty>

  return (
    <>
      {editions.map(edition => (
        <section key={edition.key} className={styles.edition}>
          <div className={styles.head}>
            <h2>
              <span className={styles.year}>{edition.year}</span>
              <span className={styles.name}>{edition.name}</span>
            </h2>
            <span className={styles.count}>{edition.posters.length} 张</span>
          </div>

          <div className={styles.sheet}>
            {edition.posters.map(poster => (
              <button
                key={poster.id}
                type="button"
                className={styles.poster}
                onClick={() => setActive(poster)}
                aria-label={`放大查看 ${edition.name} 海报`}
              >
                <Image
                  src={photoUrl(poster.storageKey)}
                  alt={poster.caption ?? `${edition.name} 海报`}
                  width={poster.width}
                  height={poster.height}
                  sizes="(max-width: 720px) 100vw, 380px" 
                  placeholder={poster.blurDataUrl ? 'blur' : 'empty'}
                  blurDataURL={poster.blurDataUrl ?? undefined}
                />
                <span className={styles.caption}>
                  <span>{poster.caption ?? edition.name}</span>
                  <span>
                    {poster.width}×{poster.height}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}

      <dialog
        ref={dialogRef}
        className={styles.lightbox}
        onClose={() => setActive(null)}
        onClick={event => {
          if (event.target === dialogRef.current) setActive(null)
        }}
      >
        {active ? (
          <>
            <Image
              src={photoUrl(active.storageKey)}
              alt={active.caption ?? ''}
              width={active.width}
              height={active.height}
              sizes="94vw"
            />
            <Button size="mini" className={styles.close} onClick={() => setActive(null)}>
              关闭
            </Button>
          </>
        ) : null}
      </dialog>
    </>
  )
}

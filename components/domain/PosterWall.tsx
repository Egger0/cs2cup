'use client'

import { useEffect, useRef, useState } from 'react'
import { Button, Empty } from '@/components/ui'
import { photoUrl } from '@/lib/media'
import { variantStorageKey } from '@/lib/photo-variants'
import type { Photo } from '@/lib/types'
import styles from './PosterWall.module.css'

function displayKey(poster: Photo) {
  const widest = poster.variantWidths.at(-1)
  return widest ? variantStorageKey(poster.storageKey, widest) : poster.storageKey
}

function srcSetFor(poster: Photo) {
  if (!poster.variantWidths.length) return undefined
  return poster.variantWidths
    .map(width => `${photoUrl(variantStorageKey(poster.storageKey, width))} ${width}w`)
    .join(', ')
}

export interface Edition {
  key: string
  year: string
  name: string
  posters: Photo[]
}

export function PosterWall({
  editions,
  emptyText = '档案整理中',
}: {
  editions: Edition[]
  emptyText?: string
}) {
  const [active, setActive] = useState<Photo | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (active && !dialog.open) dialog.showModal()
    if (!active && dialog.open) dialog.close()
  }, [active])

  if (editions.length === 0) return <Empty>{emptyText}</Empty>

  return (
    <>
      {editions.map(edition => (
        <section key={edition.key} className={styles.edition}>
          <div className={styles.head}>
            <h2>
              <span className={styles.year}>{edition.year}</span>
              <span className={styles.name}>{edition.name}</span>
            </h2>
            <span className={styles.count}>
              {edition.posters.length > 0 ? `${edition.posters.length} 张` : '整理中'}
            </span>
          </div>

          {edition.posters.length > 0 ? (
            <div className={styles.sheet}>
              {edition.posters.map(poster => (
                <button
                  key={poster.id}
                  type="button"
                  className={styles.poster}
                  onClick={() => setActive(poster)}
                  aria-label={`放大查看 ${poster.caption || `${edition.name} 海报`}`}
                >
                  <img
                    src={photoUrl(displayKey(poster))}
                    srcSet={srcSetFor(poster)}
                    sizes="(max-width: 720px) 100vw, 380px"
                    alt={poster.caption ?? `${edition.name} 海报`}
                    width={poster.width}
                    height={poster.height}
                    loading="lazy"
                    decoding="async"
                    style={{ aspectRatio: `${poster.width} / ${poster.height}` }}
                  />
                  <span className={styles.caption}>
                    <span>{poster.caption ?? edition.name}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className={styles.editionEmpty}>本届影像正在核对与整理。</p>
          )}
        </section>
      ))}

      <dialog
        ref={dialogRef}
        className={styles.lightbox}
        aria-label={active ? `赛事影像预览：${active.caption || '未命名影像'}` : '赛事影像预览'}
        onClose={() => setActive(null)}
        onClick={event => {
          if (event.target === dialogRef.current) setActive(null)
        }}
      >
        {active ? (
          <>
            <img
              src={photoUrl(displayKey(active))}
              srcSet={srcSetFor(active)}
              sizes="94vw"
              alt={active.caption ?? ''}
              width={active.width}
              height={active.height}
              decoding="async"
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

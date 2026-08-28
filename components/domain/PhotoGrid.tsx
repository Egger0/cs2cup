'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { Button, Empty } from '@/components/ui'
import { photoUrl } from '@/lib/media'
import type { Photo } from '@/lib/types'
import styles from './PhotoGrid.module.css'

export interface PhotoGroup {
  key: string
  title: string
  photos: Photo[]
}

export function PhotoGrid({ groups }: { groups: PhotoGroup[] }) {
  const [active, setActive] = useState<Photo | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (active && !dialog.open) dialog.showModal()
    if (!active && dialog.open) dialog.close()
  }, [active])

  if (groups.every(group => group.photos.length === 0)) {
    return <Empty>还没有上传往届照片</Empty>
  }

  return (
    <>
      {groups.map(group => (
        <section key={group.key} className={styles.group}>
          <div className={styles.groupHead}>
            <h2 className={styles.groupTitle}>{group.title}</h2>
            <span className={styles.count}>{group.photos.length} 张</span>
          </div>
          <div className={styles.grid}>
            {group.photos.map(photo => (
              <button
                key={photo.id}
                type="button"
                className={styles.item}
                onClick={() => setActive(photo)}
                aria-label={photo.caption ?? `查看 ${group.title} 照片`}
              >
                <Image
                  src={photoUrl(photo.storageKey)}
                  alt={photo.caption ?? ''}
                  unoptimized
                  width={photo.width}
                  height={photo.height}
                  sizes="(max-width: 700px) 50vw, 280px"
                  placeholder={photo.blurDataUrl ? 'blur' : 'empty'}
                  blurDataURL={photo.blurDataUrl ?? undefined}
                />
                {photo.caption ? <span className={styles.caption}>{photo.caption}</span> : null}
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
              unoptimized
              width={active.width}
              height={active.height}
              sizes="92vw"
            />
            <Button
              size="mini"
              className={styles.close}
              onClick={() => setActive(null)}
              aria-label="关闭"
            >
              ✕
            </Button>
          </>
        ) : null}
      </dialog>
    </>
  )
}

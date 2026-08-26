import Image from 'next/image'
import { photoUrl } from '@/lib/media'
import type { Photo } from '@/lib/types'
import styles from './PhotoBackdrop.module.css'

export function PhotoBackdrop({ photo }: { photo: Photo | null }) {
  if (!photo) return null

  return (
    <div className={styles.backdrop} aria-hidden>
      <Image
        src={photoUrl(photo.storageKey)}
        alt=""
        fill
        priority
        sizes="100vw"
        placeholder={photo.blurDataUrl ? 'blur' : 'empty'}
        blurDataURL={photo.blurDataUrl ?? undefined}
      />
      <span className={styles.tint} />
      <span className={styles.scan} />
    </div>
  )
}

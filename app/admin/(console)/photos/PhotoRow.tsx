'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { Button } from '@/components/ui'
import { adminPhotoUrl } from '@/lib/media'
import { deletePhotoAndFile } from '../_actions'
import styles from '../admin.module.css'

export function PhotoRow({
  photo,
  tournamentLabel,
}: {
  photo: { id: number; storageKey: string; width: number; height: number; caption: string | null }
  tournamentLabel: string
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')

  return (
    <div className={styles.listRow}>
      <div className={styles.photoRow}>
        <span className={styles.thumb}>
          <Image
            src={adminPhotoUrl(photo.storageKey)}
            alt=""
            width={96}
            height={64}
            sizes="96px"
            unoptimized
          />
        </span>
        <span>
          <span className={styles.listTitle}>{photo.caption ?? '未命名'}</span>
          <span className={styles.listMeta}>
            {tournamentLabel} · {photo.width}×{photo.height} · {photo.storageKey}
          </span>
        </span>
      </div>
      <div className={styles.rowActions}>
        <Button
          size="mini"
          variant="danger"
          disabled={pending}
          onClick={() => {
            if (!confirm('删除这张图片?文件也会一并移除。')) return
            startTransition(async () => {
              setError('')
              const result = await deletePhotoAndFile(photo.id)
              if (!result.ok) setError(result.error)
            })
          }}
        >
          删除
        </Button>
        {error ? <span className={styles.error}>{error}</span> : null}
      </div>
    </div>
  )
}

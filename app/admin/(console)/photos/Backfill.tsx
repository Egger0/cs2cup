'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'
import { renderImageVariants } from '@/lib/client-image'
import { photoUrl } from '@/lib/media'
import { attachPhotoVariants } from '../actions/media'
import styles from '../admin.module.css'

interface PendingPhoto {
  id: number
  storageKey: string
  caption: string | null
}

export function Backfill({ photos }: { photos: PendingPhoto[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [progress, setProgress] = useState('')
  const [failures, setFailures] = useState<string[]>([])

  if (!photos.length) return null

  const run = () => {
    setFailures([])
    startTransition(async () => {
      const failed: string[] = []
      let done = 0

      for (const photo of photos) {
        const label = photo.caption ?? photo.storageKey
        setProgress(`正在处理 ${done + 1} / ${photos.length}：${label}`)
        try {
          const response = await fetch(photoUrl(photo.storageKey))
          if (!response.ok) throw new Error(`原图读取失败 ${response.status}`)
          const blob = await response.blob()
          const rendered = await renderImageVariants(
            new File([blob], 'original', { type: blob.type }),
          )

          const form = new FormData()
          form.set('blurDataUrl', rendered.blurDataUrl)
          for (const variant of rendered.variants) {
            form.set(`variant${variant.width}`, variant.file)
          }
          const result = await attachPhotoVariants(photo.id, form)
          if (!result.ok) failed.push(`${label}：${result.error}`)
        } catch {
          failed.push(`${label}：处理失败`)
        }
        done += 1
      }

      setProgress('')
      setFailures(failed)
      router.refresh()
    })
  }

  return (
    <div className={styles.editor}>
      <p>{photos.length} 张照片还没有显示尺寸派生图，回填后档案页会显著变轻。</p>
      <div className={styles.rowActions}>
        <Button type="button" variant="primary" onClick={run} disabled={pending}>
          {pending ? '回填中…' : '生成派生图'}
        </Button>
        {progress ? (
          <span className={styles.ok} role="status">
            {progress}
          </span>
        ) : null}
      </div>
      {failures.length ? (
        <ul className={styles.error} role="alert">
          {failures.map(entry => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

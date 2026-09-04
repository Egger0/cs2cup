'use client'

import { useState, useTransition } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'
import { photoUrl } from '@/lib/media'
import { deletePhotoAndFile } from '../actions/media'
import styles from '../admin.module.css'

export function PhotoRow({
  photo,
  tournamentLabel,
}: {
  photo: { id: number; storageKey: string; width: number; height: number; caption: string | null }
  tournamentLabel: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'warning' | 'error'
    message: string
  } | null>(null)

  return (
    <div className={styles.listRow}>
      <div className={styles.photoRow}>
        <span className={styles.thumb}>
          <Image
            src={photoUrl(photo.storageKey)}
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
          aria-busy={pending}
          onClick={() => {
            if (!confirm('删除这张图片?文件也会一并移除。')) return
            startTransition(async () => {
              setFeedback(null)
              try {
                const result = await deletePhotoAndFile(photo.id)
                if (!result.ok) {
                  setFeedback({ tone: 'error', message: result.error })
                  return
                }

                setFeedback({
                  tone: result.warning ? 'warning' : 'success',
                  message: result.warning ?? '图片已删除',
                })
                if (result.warning) window.alert(result.warning)
                router.refresh()
              } catch {
                setFeedback({ tone: 'error', message: '删除失败，请检查网络后重试。' })
              }
            })
          }}
        >
          {pending ? '删除中…' : '删除'}
        </Button>
        {feedback ? (
          <span
            className={feedback.tone === 'success' ? styles.ok : styles.error}
            role={feedback.tone === 'success' ? 'status' : 'alert'}
          >
            {feedback.message}
          </span>
        ) : null}
      </div>
    </div>
  )
}

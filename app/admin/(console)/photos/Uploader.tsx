'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Field } from '@/components/ui'
import { normalizeImageFile } from '@/lib/client-image'
import type { Tournament } from '@/lib/types'
import { uploadPhoto } from '../actions/media'
import styles from '../admin.module.css'

const MAX_PHOTO_BYTES = 10 * 1024 * 1024

export function Uploader({ tournaments }: { tournaments: Tournament[] }) {
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const [pending, startTransition] = useTransition()
  const [phase, setPhase] = useState('')
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null)
  const [tooLarge, setTooLarge] = useState(false)
  const [fileName, setFileName] = useState('尚未选择图片')

  return (
    <form
      ref={formRef}
      className={styles.editor}
      aria-busy={pending}
      onSubmit={event => {
        event.preventDefault()
        if (pending || tooLarge) return

        const formData = new FormData(event.currentTarget)
        const file = formData.get('file')
        if (!(file instanceof File) || file.size === 0) {
          setFeedback({ ok: false, message: '请选择一张图片' })
          return
        }

        setFeedback(null)
        setPhase('正在优化图片…')
        startTransition(async () => {
          let uploadStarted = false
          try {
            formData.set('file', await normalizeImageFile(file))
            setPhase('正在上传…')
            uploadStarted = true
            const result = await uploadPhoto(formData)
            if (!result.ok) {
              setFeedback({ ok: false, message: result.error })
              return
            }

            formRef.current?.reset()
            setFileName('尚未选择图片')
            setTooLarge(false)
            setFeedback({ ok: true, message: `已上传 ${result.width}×${result.height}` })
            router.refresh()
          } catch {
            setFeedback({
              ok: false,
              message: uploadStarted
                ? '上传失败，请检查网络后重试。已保留所选图片。'
                : '图片预处理失败，请换一张图片重试。已保留所选图片。',
            })
          } finally {
            setPhase('')
          }
        })
      }}
    >
      <label className={styles.controlLabel}>
        归属赛事
        <select name="tournamentId" required className={styles.select} disabled={pending}>
          {tournaments.map(tournament => (
            <option key={tournament.id} value={tournament.id}>
              {tournament.season} · {tournament.title}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.controlLabel}>
        图片文件
        <span className={styles.filePicker}>
          <input
            type="file"
            name="file"
            accept="image/jpeg,image/png,image/webp"
            required
            disabled={pending}
            className={styles.fileInput}
            onChange={event => {
              const file = event.currentTarget.files?.[0]
              const invalid = Boolean(file && file.size > MAX_PHOTO_BYTES)
              setFileName(file?.name ?? '尚未选择图片')
              setTooLarge(invalid)
              setFeedback(invalid ? { ok: false, message: '单张图片不要超过 10 MB' } : null)
            }}
          />
          <span className={styles.fileAction}>选择图片</span>
          <span className={styles.fileName}>{fileName}</span>
        </span>
      </label>
      <Field id="up-caption" name="caption" label="说明" hint="选填" disabled={pending} />
      <div className={styles.rowActions}>
        <Button type="submit" variant="primary" disabled={pending || tooLarge}>
          {pending ? '上传中…' : '上传'}
        </Button>
        {phase ? (
          <span className={styles.ok} role="status">
            {phase}
          </span>
        ) : null}
        {feedback ? (
          <span
            className={feedback.ok ? styles.ok : styles.error}
            role={feedback.ok ? 'status' : 'alert'}
          >
            {feedback.message}
          </span>
        ) : null}
      </div>
    </form>
  )
}

'use client'

import { useState, useTransition } from 'react'
import { Button, Field } from '@/components/ui'
import { normalizeImageFile } from '@/lib/client-image'
import type { Tournament } from '@/lib/types'
import { uploadPhoto } from '../actions/media'
import styles from '../admin.module.css'

const MAX_PHOTO_BYTES = 10 * 1024 * 1024

export function Uploader({ tournaments }: { tournaments: Tournament[] }) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [tooLarge, setTooLarge] = useState(false)

  return (
    <form
      className={styles.editor}
      action={formData =>
        startTransition(async () => {
          setError('')
          setMessage('正在优化图片…')
          const file = formData.get('file')
          if (!(file instanceof File)) {
            setMessage('')
            setError('请选择一张图片')
            return
          }
          try {
            formData.set('file', await normalizeImageFile(file))
          } catch {
            setMessage('')
            setError('图片预处理失败，请换一张图片重试')
            return
          }
          setMessage('正在上传…')
          const result = await uploadPhoto(formData)
          if (result.ok) setMessage(`已上传 ${result.width}×${result.height}`)
          else {
            setMessage('')
            setError(result.error)
          }
        })
      }
    >
      <label className="readout">
        归属赛事
        <select name="tournamentId" required className={styles.select}>
          {tournaments.map(tournament => (
            <option key={tournament.id} value={tournament.id}>
              {tournament.season} · {tournament.title}
            </option>
          ))}
        </select>
      </label>
      <label className="readout">
        图片文件
        <input
          type="file"
          name="file"
          accept="image/jpeg,image/png,image/webp"
          required
          className={styles.file}
          onChange={event => {
            const file = event.currentTarget.files?.[0]
            const invalid = Boolean(file && file.size > MAX_PHOTO_BYTES)
            setTooLarge(invalid)
            if (invalid) setError('单张图片不要超过 10 MB')
            else setError('')
          }}
        />
      </label>
      <Field id="up-caption" name="caption" label="说明" hint="选填" />
      {error ? <p style={{ color: 'var(--c4)', fontSize: '0.88rem' }}>{error}</p> : null}
      <div className={styles.rowActions}>
        <Button type="submit" variant="primary" disabled={pending || tooLarge}>
          {pending ? '上传中…' : '上传'}
        </Button>
        {message ? <span className={styles.ok}>{message}</span> : null}
      </div>
    </form>
  )
}

'use client'

import { useRouter } from 'next/navigation'
import { useId, useState, useTransition } from 'react'
import { renderWebp } from '@/lib/client-image'
import { replaceLoadoutShotAction } from './actions'
import styles from './LoadoutCardActions.module.css'

export function LoadoutShotUpload({
  id,
  hasShot,
  reviewed,
  queued,
}: {
  id: number
  hasShot: boolean
  reviewed: boolean
  queued: boolean
}) {
  const router = useRouter()
  const input = useId()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState(queued ? '新截图审核中，通过后替换' : '')

  function upload(file: File | undefined) {
    if (!file) return
    startTransition(async () => {
      setMessage('正在上传…')
      const webp = await renderWebp(file, 1920, 0.85).catch(() => null)
      if (!webp) return setMessage('这张图片无法读取，换一张试试。')
      const data = new FormData()
      data.set('shot', webp)
      const result = await replaceLoadoutShotAction(id, data).catch(() => ({
        ok: false as const,
        error: '网络异常，请稍后重试。',
      }))
      if (!result.ok) return setMessage(result.error)
      setMessage(reviewed ? '新截图已提交，审核通过后替换' : '截图已更新')
      router.refresh()
    })
  }

  return (
    <div className={styles.shotUpload} aria-busy={pending}>
      <label htmlFor={input} className={styles.like} data-disabled={pending ? '' : undefined}>
        {hasShot ? '更换改装截图' : '补传改装截图'}
      </label>
      <input
        id={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className={styles.silent}
        disabled={pending}
        onChange={event => {
          upload(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      {message ? (
        <span className={styles.hint} role="status">
          {message}
        </span>
      ) : null}
    </div>
  )
}

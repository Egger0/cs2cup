'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { setLoadoutFeaturedAction } from '../actions'
import styles from './detail.module.css'

export function FeatureToggle({ id, featured }: { id: number; featured: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')
  return (
    <span className={styles.feature}>
      <button
        type="button"
        aria-pressed={featured}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError('')
            const result = await setLoadoutFeaturedAction(id, !featured).catch(() => ({
              ok: false as const,
              error: '网络异常，请稍后重试。',
            }))
            if (result.ok) router.refresh()
            else setError(result.error)
          })
        }
      >
        {featured ? '★ 已是社团精选' : '☆ 设为社团精选'}
      </button>
      {error ? <span role="alert">{error}</span> : null}
    </span>
  )
}

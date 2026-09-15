'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui'
import type { PendingLoadoutCode } from '@/lib/loadout-codes'
import { reviewLoadoutCodeAction } from '../actions/loadouts'
import styles from '../admin.module.css'

export function LoadoutReviewRow({ code }: { code: PendingLoadoutCode }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const review = (decision: 'approved' | 'rejected') =>
    startTransition(async () => {
      setError('')
      const result = await reviewLoadoutCodeAction(code.id, decision).catch(() => ({
        ok: false as const,
        error: '审核保存失败，请稍后重试。',
      }))
      if (result.ok) router.refresh()
      else setError(result.error)
    })

  return (
    <article className={styles.listRow} aria-busy={pending}>
      <div>
        <h3 className={styles.listTitle}>
          [{code.weapon}] {code.title}
        </h3>
        <div className={styles.listMeta}>
          {code.gameName} · {code.authorName}
          {code.note ? ` · ${code.note}` : ''}
        </div>
        <code className={styles.listMeta}>{code.code}</code>
      </div>
      <div className={styles.rowActions}>
        <Button size="mini" variant="primary" disabled={pending} onClick={() => review('approved')}>
          通过
        </Button>
        <Button size="mini" variant="danger" disabled={pending} onClick={() => review('rejected')}>
          不通过
        </Button>
        {error ? (
          <span className={styles.error} role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </article>
  )
}

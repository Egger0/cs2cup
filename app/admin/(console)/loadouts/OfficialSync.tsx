'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button } from '@/components/ui'
import { syncOfficialLoadoutsAction } from '../actions/loadouts'
import styles from '../admin.module.css'

export function OfficialSync() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState('')
  return (
    <div className={styles.rowActions}>
      <Button
        size="mini"
        variant="primary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setMessage('正在同步…')
            const result = await syncOfficialLoadoutsAction().catch(() => ({
              ok: false as const,
              error: '同步失败，请稍后重试',
            }))
            setMessage(result.ok ? result.message : result.error)
            if (result.ok) router.refresh()
          })
        }
      >
        立即同步
      </Button>
      {message ? <span role="status">{message}</span> : null}
    </div>
  )
}

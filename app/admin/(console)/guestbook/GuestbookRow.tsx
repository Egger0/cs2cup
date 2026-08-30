'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui'
import { SITE_TIME_ZONE } from '@/lib/datetime'
import type { GuestbookMessage, GuestbookMessageStatus } from '@/lib/types'
import { removeGuestbookMessage, setGuestbookMessageStatus } from '../_actions'
import styles from '../admin.module.css'

const STATUS_LABEL: Record<GuestbookMessageStatus, string> = {
  pending: '待审核',
  published: '已公开',
  hidden: '已隐藏',
}

export function GuestbookRow({ message }: { message: GuestbookMessage }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function updateStatus(status: GuestbookMessageStatus) {
    startTransition(async () => {
      setError('')
      const result = await setGuestbookMessageStatus(message.id, status)
      if (!result.ok) setError(result.error)
    })
  }

  function remove() {
    if (!confirm(`确定删除「${message.name}」的留言?此操作不可撤销。`)) return
    startTransition(async () => {
      setError('')
      const result = await removeGuestbookMessage(message.id)
      if (!result.ok) setError(result.error)
    })
  }

  return (
    <div className={styles.listRow}>
      <div>
        <div className={styles.listTitle}>{message.name}</div>
        <div className={styles.listMeta}>
          {STATUS_LABEL[message.status]} · {new Date(message.createdAt).toLocaleString('zh-CN', {
            timeZone: SITE_TIME_ZONE,
          })}
        </div>
        <p className={styles.messageBody}>{message.body}</p>
      </div>
      <div className={styles.rowActions}>
        {message.status !== 'published' ? (
          <Button size="mini" variant="primary" disabled={pending} onClick={() => updateStatus('published')}>
            公开
          </Button>
        ) : null}
        {message.status !== 'hidden' ? (
          <Button size="mini" disabled={pending} onClick={() => updateStatus('hidden')}>
            隐藏
          </Button>
        ) : null}
        {message.status !== 'pending' ? (
          <Button size="mini" disabled={pending} onClick={() => updateStatus('pending')}>
            待审核
          </Button>
        ) : null}
        <Button size="mini" variant="danger" disabled={pending} onClick={remove}>
          删除
        </Button>
        {error ? <span className={styles.error}>{error}</span> : null}
      </div>
    </div>
  )
}

'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'
import { SITE_TIME_ZONE } from '@/lib/datetime'
import type { GuestbookMessage, GuestbookMessageStatus } from '@/lib/types'
import { createOfficialGuestbookReply, removeGuestbookMessage, setGuestbookMessageStatus } from '../_actions'
import styles from '../admin.module.css'

const STATUS_LABEL: Record<GuestbookMessageStatus, string> = {
  pending: '待审核',
  published: '已公开',
  hidden: '已隐藏',
}

export function GuestbookRow({ message }: { message: GuestbookMessage }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [replyBody, setReplyBody] = useState('')

  function updateStatus(status: GuestbookMessageStatus) {
    startTransition(async () => {
      setError('')
      const result = await setGuestbookMessageStatus(message.id, status)
      if (!result.ok) setError(result.error)
      else router.refresh()
    })
  }

  function remove() {
    if (!confirm(`确定删除「${message.name}」的留言?此操作不可撤销。`)) return
    startTransition(async () => {
      setError('')
      const result = await removeGuestbookMessage(message.id)
      if (!result.ok) setError(result.error)
      else router.refresh()
    })
  }

  function replyOfficially() {
    startTransition(async () => {
      setError('')
      const result = await createOfficialGuestbookReply(message.id, replyBody)
      if (!result.ok) setError(result.error)
      else {
        setReplyBody('')
        router.refresh()
      }
    })
  }

  return (
    <div className={styles.listRow}>
      <div>
        <div className={styles.listTitle}>{message.name}</div>
        <div className={styles.listMeta}>
          {message.parentId === null ? '主留言' : `回复 #${message.parentId}`} · {message.official ? '官方 · ' : ''}
          {STATUS_LABEL[message.status]} · {new Date(message.createdAt).toLocaleString('zh-CN', {
            timeZone: SITE_TIME_ZONE,
          })}
        </div>
        <p className={styles.messageBody}>{message.body}</p>
        {message.parentId === null && message.status === 'published' ? (
          <div className={styles.officialReply}>
            <textarea
              value={replyBody}
              onChange={event => setReplyBody(event.target.value)}
              maxLength={500}
              rows={2}
              placeholder="发布带官方标识的回复"
              disabled={pending}
            />
            <Button size="mini" variant="primary" disabled={pending || !replyBody.trim()} onClick={replyOfficially}>
              官方回复
            </Button>
          </div>
        ) : null}
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
        <Button size="mini" variant="danger" disabled={pending} onClick={remove}>
          删除
        </Button>
        {error ? <span className={styles.error}>{error}</span> : null}
      </div>
    </div>
  )
}

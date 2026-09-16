'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { CopyTextButton } from '@/components/ui/CopyTextButton'
import { recordLoadoutCopyAction, reportLoadoutCodeAction, setLoadoutLikeAction } from './actions'
import styles from './LoadoutCardActions.module.css'

function firstCopyThisSession(id: number) {
  try {
    const key = `loadout-copied:${id}`
    if (sessionStorage.getItem(key)) return false
    sessionStorage.setItem(key, '1')
  } catch {}
  return true
}

export function LoadoutCardActions({
  id,
  value,
  title,
  live,
  signedIn,
  likes,
  liked,
  reported,
}: {
  id: number
  value: string
  title: string
  live: boolean
  signedIn: boolean
  likes: number
  liked: boolean
  reported: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [like, setLike] = useState({ liked, count: likes })
  const [message, setMessage] = useState<string | null>(reported ? '已反馈失效' : null)

  function toggleLike() {
    const next = { liked: !like.liked, count: like.count + (like.liked ? -1 : 1) }
    const previous = like
    setLike(next)
    startTransition(async () => {
      const result = await setLoadoutLikeAction(id, next.liked).catch(() => ({
        ok: false as const,
        error: '网络异常，请稍后重试。',
      }))
      if (!result.ok) {
        setLike(previous)
        setMessage(result.error)
      }
    })
  }

  return (
    <div className={styles.actions}>
      <CopyTextButton
        value={value}
        label={`复制「${title}」改枪码`}
        className={styles.copy}
        onCopied={() => {
          if (firstCopyThisSession(id)) void recordLoadoutCopyAction(id).catch(() => {})
        }}
      >
        复制改枪码
      </CopyTextButton>
      {live ? (
        <span className={styles.feedback}>
          {signedIn ? (
            <button
              type="button"
              className={styles.like}
              aria-pressed={like.liked}
              disabled={pending}
              onClick={toggleLike}
            >
              好用 <b>{like.count}</b>
            </button>
          ) : (
            <Link
              className={styles.like}
              href="/login"
              aria-label={`登录后点好用，已有 ${like.count} 人觉得好用`}
            >
              好用 <b>{like.count}</b>
            </Link>
          )}
          {message ? (
            <span className={styles.reported} role="status">
              {message}
            </span>
          ) : signedIn ? (
            <button
              type="button"
              className={styles.report}
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await reportLoadoutCodeAction(id).catch(() => ({
                    ok: false as const,
                    error: '网络异常，请稍后重试。',
                  }))
                  setMessage(result.ok ? '已反馈失效，谢谢' : result.error)
                })
              }
            >
              反馈失效
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  )
}

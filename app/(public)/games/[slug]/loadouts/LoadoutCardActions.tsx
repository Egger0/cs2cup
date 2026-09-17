'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useTransition } from 'react'
import { Icon } from '@/components/ui/Icon'
import { recordLoadoutCopyAction, setLoadoutFavoriteAction, setLoadoutLikeAction } from './actions'
import styles from './LoadoutCardActions.module.css'

function firstCopyThisSession(id: number) {
  try {
    const key = `loadout-copied:${id}`
    if (sessionStorage.getItem(key)) return false
    sessionStorage.setItem(key, '1')
  } catch {}
  return true
}

export function LoadoutCopyButton({
  id,
  value,
  title,
  className,
  hint = false,
}: {
  id: number
  value: string
  title: string
  className?: string
  hint?: boolean
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  async function copy() {
    clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(value)
      setState('copied')
      timer.current = setTimeout(() => setState('idle'), 2600)
      if (firstCopyThisSession(id)) void recordLoadoutCopyAction(id).catch(() => {})
    } catch {
      setState('manual')
    }
  }

  return (
    <>
      <button
        type="button"
        className={`${styles.copy} ${className ?? ''}`}
        data-state={state}
        aria-label={`复制「${title}」改枪码`}
        onClick={copy}
      >
        <Icon name={state === 'copied' ? 'check' : 'copy'} size={16} />
        {state === 'copied' ? '已复制' : '复制改枪码'}
      </button>
      <span className={hint ? styles.hint : styles.silent} role="status">
        {state === 'copied'
          ? '去改枪台「方案 → 方案共享」粘贴'
          : state === 'manual'
            ? '浏览器没让自动复制，请手动复制下面这行。'
            : ''}
      </span>
      {state === 'manual' ? (
        <input
          className={styles.manual}
          aria-label={`「${title}」改枪码`}
          value={value}
          readOnly
          autoFocus
          onFocus={event => event.currentTarget.select()}
        />
      ) : null}
    </>
  )
}

export function LoadoutCardActions({
  id,
  value,
  title,
  live,
  savable,
  signedIn,
  likes,
  liked,
  saved,
}: {
  id: number
  value: string
  title: string
  live: boolean
  savable: boolean
  signedIn: boolean
  likes: number
  liked: boolean
  saved: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [like, setLike] = useState({ liked, count: likes })
  const [message, setMessage] = useState<string | null>(null)
  const [keep, setKeep] = useState(saved)

  function toggleSave() {
    const next = !keep
    setKeep(next)
    startTransition(async () => {
      const result = await setLoadoutFavoriteAction(id, next).catch(() => ({
        ok: false as const,
        error: '网络异常，请稍后重试。',
      }))
      if (!result.ok) {
        setKeep(!next)
        setMessage(result.error)
      }
    })
  }

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
      <span className={styles.copyGroup}>
        <LoadoutCopyButton id={id} value={value} title={title} />
      </span>
      {savable && signedIn ? (
        <button
          type="button"
          className={styles.save}
          aria-pressed={keep}
          aria-label={keep ? `取消收藏「${title}」` : `收藏「${title}」`}
          title={keep ? '已收藏' : '收藏'}
          disabled={pending}
          onClick={toggleSave}
        >
          <Icon name="bookmark" size={18} />
        </button>
      ) : null}
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
          ) : null}
        </span>
      ) : null}
    </div>
  )
}

'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { formatSiteNumericDateTime } from '@/lib/datetime'
import styles from './security.module.css'

interface SessionSummary {
  id: string
  current: boolean
  authMethod: string
  clientLabel: string | null
  createdAt: number
  lastSeenAt: number
  idleExpiresAt: number
  absoluteExpiresAt: number
}

const METHODS: Record<string, string> = {
  password: '密码',
  passkey: 'Passkey',
  recovery_code: '恢复码',
}

function date(value: number) {
  return formatSiteNumericDateTime(value) ?? '时间不可用'
}

async function body(response: Response) {
  return (await response.json().catch(() => null)) as {
    sessions?: SessionSummary[]
    error?: string
    redirectTo?: string
  } | null
}

export function SessionManager() {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [working, setWorking] = useState(false)
  const [confirming, setConfirming] = useState('')
  const [error, setError] = useState('')
  const [reauthenticate, setReauthenticate] = useState('')

  async function load() {
    const response = await fetch('/api/account/security/sessions', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
    const data = await body(response)
    if (!response.ok || !data?.sessions) {
      throw new Error(data?.error ?? '暂时无法读取已登录设备。')
    }
    setSessions(data.sessions)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch(caught => setError(caught instanceof Error ? caught.message : '读取失败。'))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function revoke(target: string) {
    if (working) return
    if (confirming !== target) {
      setConfirming(target)
      return
    }
    setWorking(true)
    setError('')
    setReauthenticate('')
    try {
      const response = await fetch('/api/account/security/sessions', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(target === 'all' ? { allOthers: true } : { sessionId: target }),
      })
      const data = await body(response)
      if (!response.ok) {
        if (data?.redirectTo) setReauthenticate(data.redirectTo)
        throw new Error(data?.error ?? '暂时无法撤销这个会话。')
      }
      setConfirming('')
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '暂时无法管理已登录设备。')
    } finally {
      setWorking(false)
    }
  }

  const otherCount = sessions.filter(session => !session.current).length
  return (
    <section className={styles.section} aria-labelledby="sessions-title" aria-busy={working}>
      <header>
        <div>
          <p>SESSIONS / 已登录设备</p>
          <h2 id="sessions-title">设备与会话</h2>
        </div>
        <span>{sessions.length} 个有效状态</span>
      </header>
      <p className={styles.explanation}>最多显示最近 20 个有效会话。当前设备始终排在第一位。</p>
      <ul className={styles.sessionList}>
        {sessions.map(session => (
          <li key={session.id}>
            <div>
              <strong>
                {session.current
                  ? `当前设备${session.clientLabel ? ` · ${session.clientLabel}` : ''}`
                  : (session.clientLabel ?? '其他设备')}
              </strong>
              <span>{METHODS[session.authMethod] ?? '账号'}登录</span>
              <span>最近活动：{date(session.lastSeenAt)}</span>
              <small>
                登录于 {date(session.createdAt)} · 最晚 {date(session.absoluteExpiresAt)} 失效
              </small>
            </div>
            {!session.current ? (
              <button
                type="button"
                data-confirming={confirming === session.id}
                disabled={working}
                onClick={() => void revoke(session.id)}
              >
                {confirming === session.id ? '再次点击确认' : '退出此设备'}
              </button>
            ) : (
              <span className={styles.currentBadge}>正在使用</span>
            )}
          </li>
        ))}
      </ul>
      {otherCount ? (
        <button
          type="button"
          data-confirming={confirming === 'all'}
          disabled={working}
          onClick={() => void revoke('all')}
        >
          {confirming === 'all' ? `确认退出其他 ${otherCount} 个会话` : '退出所有其他设备'}
        </button>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {reauthenticate ? (
        <Link className={styles.inlineLink} href={reauthenticate}>
          重新登录后继续
        </Link>
      ) : null}
    </section>
  )
}

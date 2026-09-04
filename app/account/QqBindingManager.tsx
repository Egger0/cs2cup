'use client'

import { useState } from 'react'

import styles from './QqBindingManager.module.css'

interface BindingCodePayload {
  ok?: boolean
  code?: string
  expiresAt?: number
  error?: string
}

export function QqBindingManager() {
  const [code, setCode] = useState('')
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  async function generate() {
    if (working) return
    setWorking(true)
    setError('')
    try {
      const response = await fetch('/api/account/qq-binding-code', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
      const payload = (await response.json().catch(() => null)) as BindingCodePayload | null
      if (!response.ok || !payload?.code || !payload.expiresAt) {
        throw new Error(payload?.error ?? '暂时无法生成绑定码。')
      }
      setCode(payload.code)
      setExpiresAt(payload.expiresAt)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '暂时无法生成绑定码。')
    } finally {
      setWorking(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      setError('浏览器未允许复制，请手动输入绑定码。')
    }
  }

  const expiry = expiresAt
    ? new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(expiresAt)
    : null

  return (
    <section className={styles.qqBinding} aria-labelledby="qq-binding-title" aria-busy={working}>
      <p>QQ BOT / 社团打卡</p>
      <h2 id="qq-binding-title">绑定官方群机器人</h2>
      <p className={styles.qqBindingCopy}>
        获取一次性绑定码后，在官方群里艾特机器人并发送“/绑定
        绑定码”。绑定后可使用签到、签到排行和最近赛事。
      </p>
      {code ? (
        <div className={styles.qqBindingCode} role="status">
          <strong>{code}</strong>
          <span>请在 {expiry} 前使用；重新生成会使旧码失效。</span>
          <button type="button" onClick={() => void copy()}>
            复制绑定码
          </button>
        </div>
      ) : null}
      <button type="button" onClick={() => void generate()} disabled={working}>
        {working ? '正在生成…' : code ? '重新生成绑定码' : '生成 QQ 绑定码'}
      </button>
      {error ? <span role="alert">{error}</span> : null}
    </section>
  )
}

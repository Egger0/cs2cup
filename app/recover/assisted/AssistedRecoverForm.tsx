'use client'

import { useState, type FormEvent } from 'react'
import formStyles from '../../login/credential-form.module.css'

const INCOMPLETE_LINK = '链接不完整。请从管理员发来的消息里完整复制链接，再重新打开。'

export function AssistedRecoverForm() {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (working) return
    const secret = window.location.hash.slice(1)
    if (!secret) {
      setError(INCOMPLETE_LINK)
      return
    }
    setWorking(true)
    setError('')
    try {
      const response = await fetch('/api/auth/assisted-recovery', {
        method: 'POST',
        body: new URLSearchParams({ secret }),
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })
      const payload = (await response.json().catch(() => null)) as {
        error?: string
        redirectTo?: string
      } | null
      if (!response.ok || !payload?.redirectTo) {
        setError(payload?.error ?? '账号找回暂时不可用，请稍后重试。')
        return
      }
      window.location.replace(payload.redirectTo)
    } catch {
      setError('账号找回暂时不可用，请稍后重试。')
    } finally {
      setWorking(false)
    }
  }

  return (
    <form className={formStyles.passwordForm} onSubmit={submit} aria-busy={working}>
      {error ? (
        <p className={formStyles.formError} role="alert">
          {error}
        </p>
      ) : null}
      <button className={formStyles.passwordButton} type="submit" disabled={working}>
        <span>{working ? '正在验证…' : '继续重设密码'}</span>
        <span aria-hidden="true">↗</span>
      </button>
    </form>
  )
}

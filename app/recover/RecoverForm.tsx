'use client'

import { useState, type FormEvent } from 'react'
import formStyles from '../login/credential-form.module.css'
import loginStyles from '../login/login.module.css'

function encodedForm(form: HTMLFormElement) {
  const encoded = new URLSearchParams()
  for (const [key, value] of new FormData(form)) {
    if (typeof value === 'string') encoded.append(key, value)
  }
  return encoded
}

export function RecoverForm() {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [inputError, setInputError] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (working) return
    setWorking(true)
    setError('')
    setInputError(false)
    try {
      const response = await fetch('/api/auth/recovery-code', {
        method: 'POST',
        body: encodedForm(event.currentTarget),
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
        setError(payload?.error ?? '账号恢复暂时不可用，请稍后重试。')
        setInputError(response.status === 400 || response.status === 401)
        return
      }
      window.location.assign(payload.redirectTo)
    } catch {
      setError('账号恢复暂时不可用，请稍后重试。')
    } finally {
      setWorking(false)
    }
  }

  return (
    <form
      className={formStyles.passwordForm}
      onSubmit={submit}
      aria-busy={working}
      onChange={() => {
        if (inputError) {
          setError('')
          setInputError(false)
        }
      }}
    >
      <label className={formStyles.field}>
        <span>用户名</span>
        <input
          name="username"
          autoComplete="username"
          maxLength={32}
          spellCheck={false}
          disabled={working}
          aria-invalid={inputError}
          aria-describedby={error ? 'recovery-error' : undefined}
          required
        />
      </label>
      <label className={formStyles.field}>
        <span>恢复码</span>
        <input
          name="code"
          autoComplete="one-time-code"
          maxLength={32}
          spellCheck={false}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          disabled={working}
          aria-invalid={inputError}
          aria-describedby={error ? 'recovery-error' : undefined}
          required
        />
      </label>
      <button className={formStyles.passwordButton} type="submit" disabled={working}>
        <span className={loginStyles.buttonCode} aria-hidden="true">
          RC
        </span>
        <span>{working ? '正在验证…' : '继续重设密码'}</span>
        <span aria-hidden="true">↗</span>
      </button>
      {error ? (
        <p
          id="recovery-error"
          className={inputError ? formStyles.formError : formStyles.formNotice}
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </form>
  )
}

'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { PasswordInput } from '@/components/ui/PasswordInput'
import { registrationAuthHref } from '@/lib/registration-navigation'
import formStyles from './credential-form.module.css'
import styles from './login.module.css'

const FAILURE_COPY: Record<string, string> = {
  invalid: '用户名或密码不正确，请重新输入。',
  locked: '尝试次数较多，请稍后再试；现有账号和资料不会改变。',
  rate: '尝试过于频繁，请稍后再试。',
  request: '请求来源无法确认，请刷新页面后重试。',
  setup: '登录服务暂时不可用，请稍后重试。',
}

function encodedForm(form: HTMLFormElement) {
  const encoded = new URLSearchParams()
  for (const [key, value] of new FormData(form)) {
    if (typeof value === 'string') encoded.append(key, value)
  }
  return encoded
}

export function PasswordLoginForm({
  redirectKey,
  tournamentSlug,
  returnTo,
  initialError,
}: {
  redirectKey: string
  tournamentSlug: string
  returnTo: string
  initialError?: string
}) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState(initialError ? FAILURE_COPY[initialError] : '')
  const [inputError, setInputError] = useState(initialError === 'invalid')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (working) return
    const form = event.currentTarget
    setWorking(true)
    setError('')
    setInputError(false)
    try {
      const response = await fetch('/api/auth/session', {
        method: 'POST',
        body: encodedForm(form),
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
        setError(payload?.error ?? FAILURE_COPY.setup)
        setInputError(response.status === 401)
        return
      }
      window.location.assign(payload.redirectTo)
    } catch {
      setError(FAILURE_COPY.setup)
    } finally {
      setWorking(false)
    }
  }

  return (
    <form
      className={formStyles.passwordForm}
      action="/api/auth/session"
      method="post"
      onSubmit={submit}
      aria-busy={working}
      onChange={() => {
        if (inputError) {
          setError('')
          setInputError(false)
        }
      }}
    >
      <input type="hidden" name="redirectKey" value={redirectKey} />
      <input type="hidden" name="tournamentSlug" value={tournamentSlug} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <label className={formStyles.field}>
        <span>用户名</span>
        <input
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          enterKeyHint="next"
          inputMode="text"
          maxLength={32}
          spellCheck={false}
          disabled={working}
          aria-invalid={inputError}
          aria-describedby={error ? 'login-error' : undefined}
          required
        />
      </label>
      <label className={formStyles.field}>
        <span>密码</span>
        <PasswordInput
          name="password"
          autoComplete="current-password"
          maxLength={1024}
          disabled={working}
          aria-invalid={inputError}
          aria-describedby={error ? 'login-error' : undefined}
          required
        />
      </label>
      <button
        className={formStyles.passwordButton}
        type="submit"
        disabled={working}
        aria-label={working ? '正在登录' : '使用账号密码登录'}
      >
        <span className={styles.buttonCode} aria-hidden="true">
          PW
        </span>
        <span>{working ? '正在登录…' : '登录'}</span>
        <span aria-hidden="true">↗</span>
      </button>
      {error ? (
        <p
          id="login-error"
          className={inputError ? formStyles.formError : formStyles.formNotice}
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <Link
        className={formStyles.recoveryLink}
        href={registrationAuthHref('recover', tournamentSlug)}
      >
        忘记密码？使用恢复码
      </Link>
    </form>
  )
}

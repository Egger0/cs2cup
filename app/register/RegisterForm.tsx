'use client'

import { useState, type FormEvent } from 'react'
import formStyles from '../login/credential-form.module.css'
import loginStyles from '../login/login.module.css'
import styles from './register.module.css'

const FAILURE_COPY: Record<string, string> = {
  rate: '创建尝试过于频繁，请稍后再试。',
  request: '请求来源无法确认，请刷新页面后重试。',
  screening_unavailable: '暂时无法安全检查新密码。你的账号尚未创建，请稍后重试。',
  setup: '创建账号服务暂时不可用，本次没有保存，请稍后重试。',
  signed_in: '当前浏览器已有登录账号，请先退出后再创建新账号。',
  username_unavailable: '这个用户名不可用，请换一个再试。',
}

function encodedForm(form: HTMLFormElement) {
  const encoded = new URLSearchParams()
  for (const [key, value] of new FormData(form)) {
    if (typeof value === 'string') encoded.append(key, value)
  }
  return encoded
}

export function RegisterForm({ initialError }: { initialError?: string }) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState(initialError ? FAILURE_COPY[initialError] : '')
  const [errorField, setErrorField] = useState('')
  const [passwordLength, setPasswordLength] = useState(0)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (working) return
    const form = event.currentTarget
    setWorking(true)
    setError('')
    setErrorField('')
    try {
      const response = await fetch('/api/auth/register', {
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
        field?: string
        redirectTo?: string
      } | null
      if (!response.ok || !payload?.redirectTo) {
        setError(payload?.error ?? FAILURE_COPY.setup)
        setErrorField(payload?.field ?? '')
        const field = payload?.field ? form.elements.namedItem(payload.field) : null
        if (field instanceof HTMLElement) field.focus()
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
      className={`${formStyles.passwordForm} ${styles.form}`}
      action="/api/auth/register"
      method="post"
      onSubmit={submit}
    >
      <div className={styles.nameGrid}>
        <label className={formStyles.field}>
          <span>用户名</span>
          <input
            name="username"
            autoComplete="username"
            maxLength={32}
            spellCheck={false}
            aria-invalid={errorField === 'username'}
            required
          />
          <small>3–32 位小写字母、数字、点、短横线或下划线</small>
        </label>
        <label className={formStyles.field}>
          <span>显示名称</span>
          <input
            name="displayName"
            autoComplete="nickname"
            maxLength={80}
            aria-invalid={errorField === 'displayName'}
            required
          />
          <small>用于账号与审核界面，可以稍后修改</small>
        </label>
      </div>
      <label className={formStyles.field}>
        <span>密码</span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          maxLength={1024}
          aria-invalid={errorField === 'password'}
          aria-describedby="password-guidance"
          onChange={event => setPasswordLength(Array.from(event.currentTarget.value).length)}
          required
        />
        <small id="password-guidance">
          至少 15 个字符，可使用易记的长句；当前 {passwordLength} 个字符
        </small>
      </label>
      <label className={formStyles.field}>
        <span>确认密码</span>
        <input
          name="passwordConfirmation"
          type="password"
          autoComplete="new-password"
          maxLength={1024}
          aria-invalid={errorField === 'passwordConfirmation'}
          required
        />
      </label>
      {error ? (
        <p className={formStyles.formError} role="alert">
          {error}
        </p>
      ) : null}
      <button className={formStyles.passwordButton} type="submit" disabled={working}>
        <span className={loginStyles.buttonCode} aria-hidden="true">
          01
        </span>
        <span>{working ? '正在安全创建…' : '创建账号'}</span>
        <span aria-hidden="true">↗</span>
      </button>
      <p className={styles.after}>创建后会立即登录；成员资格申请是下一步，不会阻塞账号。</p>
    </form>
  )
}

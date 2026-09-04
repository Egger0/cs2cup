'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import styles from './security.module.css'

async function responseFailure(response: Response) {
  return (await response.json().catch(() => null)) as {
    error?: string
    field?: string
    code?: string
  } | null
}

export function InitialAccountSetup() {
  const router = useRouter()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [errorField, setErrorField] = useState('')
  const [passwordLength, setPasswordLength] = useState(0)
  const [reauthenticate, setReauthenticate] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (working) return
    const form = event.currentTarget
    const data = new FormData(form)
    const password = String(data.get('password') ?? '')
    if (password !== String(data.get('passwordConfirmation') ?? '')) {
      setError('两次输入的密码不一致。')
      setErrorField('passwordConfirmation')
      const confirmation = form.elements.namedItem('passwordConfirmation')
      if (confirmation instanceof HTMLElement) confirmation.focus()
      return
    }
    setWorking(true)
    setError('')
    setErrorField('')
    setReauthenticate(false)
    try {
      const response = await fetch('/api/account/security/initial-setup', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: data.get('username'),
          password,
          passwordConfirmation: data.get('passwordConfirmation'),
        }),
      })
      if (!response.ok) {
        const failure = await responseFailure(response)
        setError(failure?.error ?? '账号设置服务暂时不可用，本次没有保存。')
        setErrorField(failure?.field ?? '')
        setReauthenticate(failure?.code === 'reauth_required')
        const field = failure?.field ? form.elements.namedItem(failure.field) : null
        if (field instanceof HTMLElement) field.focus()
        return
      }
      router.replace('/account/security?setup=complete')
      router.refresh()
    } catch {
      setError('账号设置服务暂时不可用，本次没有保存。')
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className={styles.section} aria-labelledby="initial-setup-title">
      <header>
        <div>
          <p>ONE-TIME SETUP / 一次性设置</p>
          <h2 id="initial-setup-title">补上用户名与密码</h2>
        </div>
        <span>Passkey 已确认</span>
      </header>
      <p className={styles.explanation}>
        旧报名已经安全接入当前账号。现在设置默认登录方式，之后即可使用用户名登录、接收协作邀请并启用恢复码。
      </p>
      <form className={styles.securityForm} onSubmit={submit} aria-busy={working}>
        <label>
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
        <label>
          <span>密码</span>
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={6}
            maxLength={1024}
            aria-invalid={errorField === 'password'}
            onChange={event => setPasswordLength(Array.from(event.currentTarget.value).length)}
            required
          />
          <small>至少 6 个字符 · 当前 {passwordLength} 个字符</small>
        </label>
        <label>
          <span>确认密码</span>
          <input
            name="passwordConfirmation"
            type="password"
            autoComplete="new-password"
            minLength={6}
            maxLength={1024}
            aria-invalid={errorField === 'passwordConfirmation'}
            required
          />
        </label>
        <button type="submit" disabled={working}>
          {working ? '正在安全保存…' : '完成账号设置'}
        </button>
      </form>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {reauthenticate ? (
        <Link className={styles.inlineLink} href="/login?redirectKey=account_security&reauth=1">
          使用 Passkey 重新登录后继续
        </Link>
      ) : null}
    </section>
  )
}

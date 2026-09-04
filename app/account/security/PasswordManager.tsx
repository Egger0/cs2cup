'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import styles from './security.module.css'

async function responseMessage(response: Response) {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null
  return payload?.error ?? '密码服务暂时不可用，本次没有修改。'
}

export function PasswordManager({ recovery }: { recovery: boolean }) {
  const router = useRouter()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [length, setLength] = useState(0)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (working) return
    const form = event.currentTarget
    const data = new FormData(form)
    const password = String(data.get('password') ?? '')
    const passwordConfirmation = String(data.get('passwordConfirmation') ?? '')
    if (password !== passwordConfirmation) {
      setError('两次输入的新密码不一致。')
      return
    }
    setWorking(true)
    setError('')
    setSuccess('')
    try {
      const response = await fetch('/api/account/security/password', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: recovery ? undefined : data.get('currentPassword'),
          password,
          passwordConfirmation,
        }),
      })
      if (!response.ok) throw new Error(await responseMessage(response))
      form.reset()
      setLength(0)
      setSuccess('密码已更新，其他设备已经退出。')
      router.replace('/account/security?password=changed')
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '密码服务暂时不可用。')
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className={styles.section} aria-labelledby="password-title">
      <header>
        <div>
          <p>PASSWORD / 默认登录方式</p>
          <h2 id="password-title">{recovery ? '设置新密码' : '修改密码'}</h2>
        </div>
        <span>{recovery ? '恢复中' : '已启用'}</span>
      </header>
      <p className={styles.explanation}>
        {recovery
          ? '恢复会话只能完成这一步。设置新密码后，所有旧会话会退出，并在当前设备重新登录。'
          : '密码至少需要 6 个字符。修改后会保留当前设备，并退出其他设备。'}
      </p>
      <form className={styles.securityForm} onSubmit={submit}>
        {!recovery ? (
          <label>
            <span>当前密码</span>
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              maxLength={1024}
              required
            />
          </label>
        ) : null}
        <label>
          <span>新密码</span>
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={6}
            maxLength={1024}
            onChange={event => setLength(Array.from(event.currentTarget.value).length)}
            required
          />
          <small>至少 6 个字符 · 当前 {length} 个字符</small>
        </label>
        <label>
          <span>确认新密码</span>
          <input
            name="passwordConfirmation"
            type="password"
            autoComplete="new-password"
            minLength={6}
            maxLength={1024}
            required
          />
        </label>
        <button type="submit" disabled={working}>
          {working ? '正在安全更新…' : recovery ? '完成恢复并登录' : '更新密码'}
        </button>
      </form>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className={styles.success} role="status">
          {success}
        </p>
      ) : null}
    </section>
  )
}

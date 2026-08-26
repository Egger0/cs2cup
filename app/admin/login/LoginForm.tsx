'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Field } from '@/components/ui'
import { signIn } from '../(console)/_actions'

export function LoginForm() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function handleSubmit(formData: FormData) {
    setError('')
    setPending(true)
    try {
      const result = await signIn(
        String(formData.get('username') ?? ''),
        String(formData.get('password') ?? ''),
      )
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.replace('/admin')
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败')
    } finally {
      setPending(false)
    }
  }

  return (
    <form action={handleSubmit} style={{ display: 'grid', gap: 18, maxWidth: 360 }}>
      <Field id="username" name="username" label="管理员账号" required autoComplete="username" />
      <Field
        id="password"
        name="password"
        type="password"
        label="密码"
        required
        autoComplete="current-password"
      />
      {error ? <p style={{ color: 'var(--c4)', fontSize: '0.86rem' }}>{error}</p> : null}
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? '登录中…' : '登录'}
      </Button>
    </form>
  )
}

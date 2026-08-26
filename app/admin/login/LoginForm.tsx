'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Field } from '@/components/ui'
import { signIn } from '../_actions'

declare global {
  interface Window {
    cloudbase?: {
      init: (config: { env: string; accessKey: string; region: string }) => {
        auth: () => {
          signIn: (input: { username: string; password: string }) => Promise<unknown>
          getAccessToken: () => Promise<{ accessToken: string }>
        }
      }
    }
  }
}

const SDK_URL = 'https://static.cloudbase.net/cloudbase-js-sdk/3.8.2/cloudbase.full.js'

function loadSdk() {
  if (window.cloudbase) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SDK_URL
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('SDK 加载失败'))
    document.head.append(script)
  })
}

export interface LoginFormProps {
  env: string
  anonKey: string
  region: string
}

export function LoginForm({ env, anonKey, region }: LoginFormProps) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function handleSubmit(formData: FormData) {
    setError('')
    setPending(true)
    try {
      await loadSdk()
      const app = window.cloudbase?.init({ env, accessKey: anonKey, region })
      if (!app) throw new Error('SDK 初始化失败')

      const auth = app.auth()
      await auth.signIn({
        username: String(formData.get('username') ?? ''),
        password: String(formData.get('password') ?? ''),
      })
      const { accessToken } = await auth.getAccessToken()

      const result = await signIn(accessToken)
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

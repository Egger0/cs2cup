'use client'

import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import styles from './security.module.css'

interface PasskeySummary {
  credentialId: string
  label: string
  deviceType: string
  backedUp: boolean
  createdAt: number
  lastUsedAt: number | null
}

type RegistrationOptions = Parameters<typeof startRegistration>[0]['optionsJSON']

function date(value: number | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '尚未使用'
}

async function responseMessage(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null
  return payload?.error ?? fallback
}

export function PasskeyManager() {
  const router = useRouter()
  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([])
  const [supported, setSupported] = useState<boolean | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [label, setLabel] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)

  async function load() {
    const response = await fetch('/api/auth/passkeys', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) throw new Error(await responseMessage(response, '暂时无法读取 Passkey。'))
    const payload = (await response.json()) as { passkeys: PasskeySummary[] }
    setPasskeys(payload.passkeys)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSupported(browserSupportsWebAuthn())
      void load().catch(caught => {
        setError(caught instanceof Error ? caught.message : '暂时无法读取 Passkey。')
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function enroll() {
    if (working || supported !== true) return
    setWorking(true)
    setError('')
    try {
      const optionsResponse = await fetch('/api/auth/passkeys/enroll/options', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() || undefined }),
      })
      if (!optionsResponse.ok) {
        throw new Error(await responseMessage(optionsResponse, '暂时无法开始设备验证。'))
      }
      const registration = await startRegistration({
        optionsJSON: (await optionsResponse.json()) as RegistrationOptions,
      })
      const verifyResponse = await fetch('/api/auth/passkeys/enroll/verify', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(registration),
      })
      if (!verifyResponse.ok) {
        throw new Error(await responseMessage(verifyResponse, '设备验证未完成，请重新尝试。'))
      }
      setLabel('')
      await load()
    } catch (caught) {
      setError(
        caught instanceof Error && caught.name === 'NotAllowedError'
          ? '设备确认已取消；账号和现有 Passkey 没有改变。'
          : caught instanceof Error
            ? caught.message
            : '暂时无法添加 Passkey。',
      )
    } finally {
      setWorking(false)
    }
  }

  async function revoke(credentialId: string) {
    if (working) return
    if (confirming !== credentialId) {
      setConfirming(credentialId)
      return
    }
    setWorking(true)
    setError('')
    try {
      const response = await fetch('/api/auth/passkeys', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId }),
      })
      if (!response.ok) throw new Error(await responseMessage(response, '暂时无法移除 Passkey。'))
      router.replace('/login?redirectKey=account_security')
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '暂时无法移除 Passkey。')
      setWorking(false)
      setConfirming(null)
    }
  }

  return (
    <section className={styles.section} aria-labelledby="passkeys-title" aria-busy={working}>
      <header>
        <div>
          <p>PASSKEYS / 可选快捷登录</p>
          <h2 id="passkeys-title">你的设备密钥</h2>
        </div>
        <span>{passkeys.length} 个</span>
      </header>
      <p className={styles.explanation}>
        Passkey 是密码之外的快捷登录方式。它绑定当前账号，不会创建第二个身份，也不会影响成员资格。
      </p>

      {passkeys.length ? (
        <ul className={styles.passkeyList}>
          {passkeys.map(passkey => (
            <li key={passkey.credentialId}>
              <div>
                <strong>{passkey.label}</strong>
                <span>
                  {passkey.deviceType === 'multiDevice' ? '可同步设备' : '当前设备'} ·{' '}
                  {passkey.backedUp ? '已备份' : '未标记备份'}
                </span>
                <small>
                  上次使用：{date(passkey.lastUsedAt)} · 添加：{date(passkey.createdAt)}
                </small>
              </div>
              <button
                type="button"
                disabled={working}
                data-confirming={confirming === passkey.credentialId}
                onClick={() => void revoke(passkey.credentialId)}
              >
                {confirming === passkey.credentialId ? '再次点击确认移除' : '移除'}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>尚未添加 Passkey；账号密码仍可正常登录。</p>
      )}

      <div className={styles.enroll}>
        <label>
          <span>设备名称（可选）</span>
          <input
            value={label}
            maxLength={80}
            placeholder="例如：我的 MacBook"
            onChange={event => setLabel(event.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          disabled={working || supported !== true}
          onClick={() => void enroll()}
        >
          {supported === null
            ? '正在检查设备…'
            : supported
              ? working
                ? '等待设备确认…'
                : '添加 Passkey'
              : '当前浏览器不支持'}
        </button>
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}

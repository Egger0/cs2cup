'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import styles from './security.module.css'

interface Summary {
  enabled: boolean
  remaining: number
  createdAt: number | null
}

async function payload(response: Response) {
  return (await response.json().catch(() => null)) as {
    error?: string
    redirectTo?: string
    codes?: string[]
    enabled?: boolean
    remaining?: number
    createdAt?: number | null
  } | null
}

export function RecoveryCodeManager() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [codes, setCodes] = useState<string[]>([])
  const [working, setWorking] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [reauthenticate, setReauthenticate] = useState('')

  async function load() {
    const response = await fetch('/api/account/security/recovery-codes', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
    const data = await payload(response)
    if (!response.ok || data?.enabled === undefined) {
      throw new Error(data?.error ?? '暂时无法读取恢复码状态。')
    }
    setSummary({
      enabled: data.enabled,
      remaining: data.remaining ?? 0,
      createdAt: data.createdAt ?? null,
    })
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch(caught => setError(caught instanceof Error ? caught.message : '读取失败。'))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function generate() {
    if (working) return
    if (summary?.enabled && !confirming) {
      setConfirming(true)
      return
    }
    setWorking(true)
    setError('')
    setReauthenticate('')
    try {
      const response = await fetch('/api/account/security/recovery-codes', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
      const data = await payload(response)
      if (!response.ok || !data?.codes) {
        if (data?.redirectTo) setReauthenticate(data.redirectTo)
        throw new Error(data?.error ?? '暂时无法生成恢复码。')
      }
      setCodes(data.codes)
      setConfirming(false)
      await load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '暂时无法生成恢复码。')
    } finally {
      setWorking(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'))
    } catch {
      setError('浏览器未允许复制，请手动保存。')
    }
  }

  return (
    <section className={styles.section} aria-labelledby="recovery-title" aria-busy={working}>
      <header>
        <div>
          <p>RECOVERY / 恢复码</p>
          <h2 id="recovery-title">账号的离线退路</h2>
        </div>
        <span>{summary?.enabled ? `剩余 ${summary.remaining} 枚` : '尚未生成'}</span>
      </header>
      <p className={styles.explanation}>
        每枚恢复码只能使用一次。请保存到密码管理器或其他安全位置，不要留在这台设备的截图里。
      </p>
      {codes.length ? (
        <div className={styles.codeReceipt} role="status">
          <strong>现在保存；离开页面后不会再次显示。</strong>
          <ol>
            {codes.map(code => (
              <li key={code}>{code}</li>
            ))}
          </ol>
          <button type="button" onClick={() => void copy()}>
            复制全部
          </button>
        </div>
      ) : null}
      <button
        type="button"
        data-confirming={confirming}
        disabled={working || summary === null}
        onClick={() => void generate()}
      >
        {working
          ? '正在生成…'
          : summary?.enabled
            ? confirming
              ? '再次点击，旧恢复码将失效'
              : '重新生成恢复码'
            : '生成恢复码'}
      </button>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {reauthenticate ? (
        <Link className={styles.inlineLink} href={reauthenticate}>
          重新登录后继续
        </Link>
      ) : null}
    </section>
  )
}

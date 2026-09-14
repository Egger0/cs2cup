'use client'

import { useState } from 'react'
import { formatSiteNumericDateTime } from '@/lib/datetime'
import { postIdentityForm } from './identity-command'
import styles from './identity.module.css'
import ops from './operations.module.css'

interface IssuedLink {
  readonly username: string
  readonly href: string
  readonly expiresAt: number
}

export function AccountRecovery() {
  const [username, setUsername] = useState('')
  const [evidence, setEvidence] = useState('')
  const [issued, setIssued] = useState<IssuedLink | null>(null)
  const [copied, setCopied] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  async function issue() {
    setWorking(true)
    setError('')
    setIssued(null)
    setCopied(false)
    try {
      const payload = await postIdentityForm<{ secret: string; expiresAt: number }>(
        '/api/admin/identity/recovery',
        { username, evidence },
      )
      if (!payload?.secret || !payload.expiresAt) throw new Error('找回链接没有生成，请重试。')
      setIssued({
        username: username.trim().toLowerCase(),
        href: `${window.location.origin}/recover/assisted#${payload.secret}`,
        expiresAt: payload.expiresAt,
      })
      setUsername('')
      setEvidence('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '找回链接没有生成。')
    } finally {
      setWorking(false)
    }
  }

  async function copy(href: string) {
    try {
      await navigator.clipboard.writeText(href)
      setCopied(true)
    } catch {
      setError('无法写入剪贴板，请手动选中链接复制。')
    }
  }

  return (
    <section className={ops.accessPanel} aria-labelledby="account-recovery-title">
      <div className={ops.sectionHeading}>
        <div>
          <p>PEOPLE / RECOVERY</p>
          <h2 id="account-recovery-title">账号找回</h2>
        </div>
        <span>核实身份后签发，24 小时内有效</span>
      </div>
      <form
        className={`${ops.accessForm} ${ops.recoveryForm}`}
        onSubmit={event => {
          event.preventDefault()
          void issue()
        }}
      >
        <label>
          <span>账号用户名</span>
          <input
            value={username}
            minLength={3}
            maxLength={32}
            autoComplete="off"
            spellCheck={false}
            placeholder="member.name"
            required
            onChange={event => setUsername(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>核实说明</span>
          <input
            value={evidence}
            minLength={10}
            maxLength={2000}
            placeholder="例如：QQ 私聊核实，与报名时登记的 QQ 一致"
            required
            onChange={event => setEvidence(event.currentTarget.value)}
          />
        </label>
        <button disabled={working}>{working ? '正在签发…' : '签发找回链接'}</button>
      </form>
      {issued ? (
        <div className={ops.accessList} role="status">
          <article>
            <div>
              <strong>@{issued.username} 的找回链接</strong>
              <span>
                只显示这一次，只能使用一次；{formatSiteNumericDateTime(issued.expiresAt)}{' '}
                前有效。对方重设密码后，其他设备会全部退出。
              </span>
            </div>
          </article>
          <div className={ops.recoveryLink}>
            <input
              aria-label="找回链接"
              value={issued.href}
              readOnly
              onFocus={event => event.currentTarget.select()}
            />
            <button type="button" onClick={() => void copy(issued.href)}>
              {copied ? '已复制' : '复制链接'}
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}

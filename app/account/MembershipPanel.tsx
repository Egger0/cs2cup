'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import type { AccountOverview } from '@/lib/identity/account-overview'
import styles from './membership.module.css'

const DAY_MS = 24 * 60 * 60 * 1000

const STATUS_COPY = {
  draft: ['草稿', '资料尚未提交审核。'],
  pending: ['等待审核', '申请已进入审核队列。'],
  in_review: ['审核中', '审核员正在查看这份申请。'],
  changes_requested: ['需要补充资料', '请根据审核意见更新后重新提交。'],
  approved: ['已通过', '成员资格已经生效。'],
  rejected: ['未通过', '这次申请已结束，可根据原因修改后重新申请。'],
  withdrawn: ['已撤回', '这次申请已停止，可随时重新申请。'],
} as const

function elapsedLabel(from: number, now: number) {
  const hours = Math.max(0, Math.floor((now - from) / (60 * 60 * 1000)))
  if (hours < 1) return '不到 1 小时'
  if (hours < 24) return `${hours} 小时`
  const days = Math.floor(hours / 24)
  return `${days} 天 ${hours % 24} 小时`
}

function encodedForm(form: HTMLFormElement) {
  const encoded = new URLSearchParams()
  for (const [key, value] of new FormData(form)) {
    if (typeof value === 'string') encoded.append(key, value)
  }
  return encoded
}

async function send(body: URLSearchParams) {
  const response = await fetch('/api/account/membership', {
    method: 'POST',
    body,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  const payload = (await response.json().catch(() => null)) as { error?: string } | null
  if (!response.ok) throw new Error(payload?.error ?? '暂时无法更新资格申请，请稍后重试。')
}

export function MembershipPanel({
  membership,
  now,
}: {
  membership: AccountOverview['membership']
  now: number
}) {
  const router = useRouter()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const application = membership.application
  const state = membership.status === 'approved' ? 'approved' : application?.status
  const editable = !state || ['draft', 'changes_requested', 'rejected', 'withdrawn'].includes(state)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (working) return
    setWorking(true)
    setError('')
    try {
      await send(encodedForm(event.currentTarget))
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '暂时无法更新资格申请，请稍后重试。')
    } finally {
      setWorking(false)
    }
  }

  async function command(operation: 'withdraw' | 'remind') {
    if (!application || working) return
    setWorking(true)
    setError('')
    try {
      await send(
        new URLSearchParams({
          operation,
          applicationId: application.id,
          revision: String(application.revision),
          identityClaim: '',
          contact: '',
          reason: '',
        }),
      )
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '暂时无法更新资格申请，请稍后重试。')
    } finally {
      setWorking(false)
    }
  }

  const submittedAt = application?.submittedAt ?? null
  const overdue = Boolean(submittedAt && now - submittedAt >= DAY_MS)

  return (
    <section className={styles.panel} aria-labelledby="membership-title">
      <header className={styles.header}>
        <div>
          <p>MEMBERSHIP / 资格状态</p>
          <h2 id="membership-title">{state ? STATUS_COPY[state][0] : '尚未申请'}</h2>
        </div>
        <span className={styles.state} data-state={state ?? 'none'}>
          {state ? STATUS_COPY[state][0] : 'NEXT STEP'}
        </span>
      </header>

      {state ? <p className={styles.summary}>{STATUS_COPY[state][1]}</p> : null}

      {submittedAt && ['pending', 'in_review'].includes(state ?? '') ? (
        <div className={styles.timeline}>
          <div>
            <small>提交时间</small>
            <strong>{new Date(submittedAt).toLocaleString('zh-CN')}</strong>
          </div>
          <div>
            <small>通常处理时间</small>
            <strong>24 小时内</strong>
          </div>
          <div>
            <small>已等待</small>
            <strong>{elapsedLabel(submittedAt, now)}</strong>
          </div>
        </div>
      ) : null}

      {application?.latestReviewReason &&
      ['changes_requested', 'rejected'].includes(state ?? '') ? (
        <aside className={styles.reviewNote} role="status">
          <strong>审核说明</strong>
          <p>{application.latestReviewReason}</p>
        </aside>
      ) : null}

      {editable ? (
        <form className={styles.form} onSubmit={submit}>
          <input type="hidden" name="operation" value="submit" />
          <input type="hidden" name="applicationId" value={application?.id ?? ''} />
          <input type="hidden" name="revision" value={application?.revision ?? 0} />
          <label>
            <span>身份与参与依据</span>
            <input
              name="identityClaim"
              defaultValue={application?.identityClaim ?? ''}
              maxLength={160}
              placeholder="例如：学号、院系或与社团的关系"
              required
            />
          </label>
          <label>
            <span>联系信息</span>
            <input
              name="contact"
              defaultValue={application?.contact ?? ''}
              maxLength={160}
              placeholder="便于审核联系；不会自动成为账号恢复方式"
              required
            />
          </label>
          <label>
            <span>补充说明（可选）</span>
            <textarea
              name="reason"
              defaultValue={application?.reason ?? ''}
              maxLength={500}
              rows={3}
            />
          </label>
          {error ? <p className={styles.error}>{error}</p> : null}
          <button type="submit" disabled={working}>
            {working
              ? '正在提交…'
              : state === 'changes_requested'
                ? '更新并重新提交'
                : '提交资格申请'}
          </button>
        </form>
      ) : null}

      {application && ['pending', 'in_review'].includes(state ?? '') ? (
        <div className={styles.pendingActions}>
          <p>你的账号可以正常使用。无需重复申请；通过前可准备报名资料，但暂不能最终提交。</p>
          {error ? <p className={styles.error}>{error}</p> : null}
          <div>
            {overdue ? (
              <button type="button" disabled={working} onClick={() => void command('remind')}>
                提醒审核员
              </button>
            ) : null}
            <button type="button" disabled={working} onClick={() => void command('withdraw')}>
              撤回申请
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

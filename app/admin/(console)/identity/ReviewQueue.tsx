'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { MembershipReviewQueueItem } from '@/lib/identity/membership-service'
import styles from './identity.module.css'

const DECISIONS = [
  { value: 'approved', label: '通过并授予成员资格' },
  { value: 'changes_requested', label: '请申请者补充资料' },
  { value: 'rejected', label: '拒绝本次申请' },
] as const

function elapsed(submittedAt: number | null, now: number) {
  if (submittedAt === null) return '—'
  const hours = Math.max(0, Math.floor((now - submittedAt) / 3_600_000))
  return hours < 24 ? `${hours} 小时` : `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`
}

async function command(values: Record<string, string>) {
  const body = new URLSearchParams({
    operation: '',
    applicationId: '',
    revision: '',
    submissionVersion: '',
    submissionDigest: '',
    decision: '',
    reason: '',
    ...values,
  })
  const response = await fetch('/api/admin/identity/membership', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const payload = (await response.json().catch(() => null)) as {
    error?: string
    reauthenticate?: boolean
    redirectTo?: string
  } | null
  if (!response.ok) {
    if (payload?.reauthenticate && payload.redirectTo) window.location.assign(payload.redirectTo)
    throw new Error(payload?.error ?? '暂时无法更新审核状态。')
  }
}

function ReviewCard({
  application,
  currentAccountId,
  now,
}: {
  application: MembershipReviewQueueItem
  currentAccountId: string
  now: number
}) {
  const router = useRouter()
  const [working, setWorking] = useState(false)
  const [decision, setDecision] = useState<(typeof DECISIONS)[number]['value']>('approved')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const mine = application.assignedReviewerAccountId === currentAccountId
  const selfReview = application.accountId === currentAccountId

  async function claim() {
    setWorking(true)
    setError('')
    try {
      await command({
        operation: 'claim',
        applicationId: application.id,
        revision: String(application.revision),
      })
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '暂时无法领取申请。')
    } finally {
      setWorking(false)
    }
  }

  async function review() {
    if (reason.trim().length < 3) {
      setError('请填写至少 3 个字符的审核说明。')
      return
    }
    setWorking(true)
    setError('')
    try {
      await command({
        operation: 'review',
        applicationId: application.id,
        revision: String(application.revision),
        submissionVersion: String(application.submissionVersion),
        submissionDigest: application.submissionDigest ?? '',
        decision,
        reason,
      })
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '暂时无法提交审核决定。')
    } finally {
      setWorking(false)
    }
  }

  return (
    <article className={styles.card} data-overdue={application.overdue}>
      <header>
        <div>
          <p>
            {application.overdue ? 'OVERDUE / 已超过目标' : 'IN QUEUE / 审核队列'} · 等待{' '}
            {elapsed(application.submittedAt, now)}
          </p>
          <h2>{application.applicantDisplayName}</h2>
        </div>
        <span>{application.status === 'pending' ? '待领取' : mine ? '由你审核' : '审核中'}</span>
      </header>
      <dl>
        <div>
          <dt>身份与参与依据</dt>
          <dd>{application.identityClaim}</dd>
        </div>
        <div>
          <dt>联系信息</dt>
          <dd>{application.contact}</dd>
        </div>
        {application.applicationReason ? (
          <div>
            <dt>补充说明</dt>
            <dd>{application.applicationReason}</dd>
          </div>
        ) : null}
      </dl>
      <footer>
        <div className={styles.meta}>
          <span>
            提交：
            {application.submittedAt
              ? new Date(application.submittedAt).toLocaleString('zh-CN')
              : '—'}
          </span>
          {application.lastReminderAt ? (
            <strong>
              申请者已于 {new Date(application.lastReminderAt).toLocaleString('zh-CN')} 提醒
            </strong>
          ) : null}
        </div>
        {application.status === 'pending' ? (
          <button type="button" disabled={working || selfReview} onClick={() => void claim()}>
            {selfReview ? '不能审核自己的申请' : working ? '正在领取…' : '领取并开始审核'}
          </button>
        ) : mine ? (
          <div className={styles.decision}>
            <label>
              <span>决定</span>
              <select
                value={decision}
                onChange={event => setDecision(event.currentTarget.value as typeof decision)}
              >
                {DECISIONS.map(item => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>给申请者的说明</span>
              <textarea
                value={reason}
                maxLength={1000}
                rows={3}
                onChange={event => setReason(event.currentTarget.value)}
              />
            </label>
            <button type="button" disabled={working} onClick={() => void review()}>
              {working ? '正在提交…' : '确认审核决定'}
            </button>
          </div>
        ) : (
          <p className={styles.assigned}>已由另一位审核员领取，避免重复处理。</p>
        )}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </footer>
    </article>
  )
}

export function ReviewQueue({
  applications,
  currentAccountId,
  now,
}: {
  applications: MembershipReviewQueueItem[]
  currentAccountId: string
  now: number
}) {
  if (!applications.length) {
    return <p className={styles.empty}>当前没有待处理的成员资格申请。</p>
  }
  return (
    <div className={styles.queue}>
      {applications.map(application => (
        <ReviewCard
          key={application.id}
          application={application}
          currentAccountId={currentAccountId}
          now={now}
        />
      ))}
    </div>
  )
}

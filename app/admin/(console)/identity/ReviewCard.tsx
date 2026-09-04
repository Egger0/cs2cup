'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { formatSiteNumericDateTime } from '@/lib/datetime'
import type {
  MembershipQueueReviewer,
  MembershipReviewQueueItem,
  MembershipReviewReasonCategory,
} from '@/lib/identity/membership-service'
import { membershipFields, postIdentityForm } from './identity-command'
import { ReviewHistory } from './ReviewHistory'
import styles from './identity.module.css'
import ops from './operations.module.css'

const DECISIONS = [
  { value: 'approved', label: '通过并授予成员资格' },
  { value: 'changes_requested', label: '请申请者补充资料' },
  { value: 'rejected', label: '拒绝本次申请' },
] as const

const REASONS = {
  approved: [
    { value: 'eligible', label: '资格符合' },
    { value: 'other', label: '其他' },
  ],
  changes_requested: [
    { value: 'insufficient_evidence', label: '证明材料不足' },
    { value: 'other', label: '其他' },
  ],
  rejected: [
    { value: 'not_eligible', label: '暂不符合资格' },
    { value: 'duplicate', label: '重复申请' },
    { value: 'other', label: '其他' },
  ],
} as const

function elapsed(submittedAt: number | null, now: number) {
  if (submittedAt === null) return '—'
  const hours = Math.max(0, Math.floor((now - submittedAt) / 3_600_000))
  return hours < 24 ? `${hours} 小时` : `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`
}

export function ReviewCard({
  application,
  reviewers,
  currentAccountId,
  now,
}: {
  application: MembershipReviewQueueItem
  reviewers: readonly MembershipQueueReviewer[]
  currentAccountId: string
  now: number
}) {
  const router = useRouter()
  const [working, setWorking] = useState(false)
  const [decision, setDecision] = useState<(typeof DECISIONS)[number]['value']>('approved')
  const [reasonCategory, setReasonCategory] = useState<MembershipReviewReasonCategory>('eligible')
  const [reason, setReason] = useState('')
  const [targetReviewer, setTargetReviewer] = useState('')
  const [transferReason, setTransferReason] = useState('')
  const [error, setError] = useState('')
  const mine = application.assignedReviewerAccountId === currentAccountId
  const selfReview = application.accountId === currentAccountId
  const incoming = application.transfers.find(
    transfer => transfer.active && transfer.toReviewerAccountId === currentAccountId,
  )
  const transferTargets = reviewers.filter(
    reviewer =>
      reviewer.accountId !== currentAccountId && reviewer.accountId !== application.accountId,
  )

  async function run(values: Record<string, string>) {
    setWorking(true)
    setError('')
    try {
      await postIdentityForm(
        '/api/admin/identity/membership',
        membershipFields({
          applicationId: application.id,
          revision: String(application.revision),
          ...values,
        }),
      )
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作没有完成，请稍后重试。')
    } finally {
      setWorking(false)
    }
  }

  function review() {
    if (reason.trim().length < 3) return setError('请填写至少 3 个字符的审核说明。')
    void run({
      operation: 'review',
      submissionVersion: String(application.submissionVersion),
      submissionDigest: application.submissionDigest ?? '',
      decision,
      reasonCategory,
      reason,
    })
  }

  function offerTransfer() {
    if (!targetReviewer) return setError('请选择接手的审核员。')
    if (transferReason.trim().length < 3) return setError('请填写转交原因。')
    void run({
      operation: 'transfer_offer',
      targetReviewerAccountId: targetReviewer,
      reason: transferReason,
    })
  }

  return (
    <article className={styles.card} data-overdue={application.overdue}>
      <header>
        <div>
          <p>
            {application.deadlineRisk
              ? 'DEADLINE RISK / 临近赛事截止'
              : application.overdue
                ? 'OVERDUE / 已超过目标'
                : 'IN QUEUE / 审核队列'}{' '}
            · 等待 {elapsed(application.submittedAt, now)}
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
            {application.submittedAt ? formatSiteNumericDateTime(application.submittedAt) : '—'}
          </span>
          {application.lastReminderAt ? (
            <strong>申请者已于 {formatSiteNumericDateTime(application.lastReminderAt)} 提醒</strong>
          ) : null}
        </div>
        {application.status === 'pending' ? (
          <button
            type="button"
            disabled={working || selfReview}
            onClick={() => void run({ operation: 'claim' })}
          >
            {selfReview ? '不能审核自己的申请' : working ? '正在领取…' : '领取并开始审核'}
          </button>
        ) : incoming && !mine ? (
          <div className={ops.incomingTransfer}>
            <p>
              {incoming.fromReviewerDisplayName} 邀请你接手：{incoming.reason}
            </p>
            <button
              type="button"
              disabled={working}
              onClick={() => void run({ operation: 'transfer_accept', transferId: incoming.id })}
            >
              {working ? '正在接手…' : '接受转交'}
            </button>
          </div>
        ) : mine ? (
          <>
            <div className={styles.decision}>
              <label>
                <span>决定</span>
                <select
                  value={decision}
                  onChange={event => {
                    const value = event.currentTarget.value as typeof decision
                    setDecision(value)
                    setReasonCategory(REASONS[value][0].value)
                  }}
                >
                  {DECISIONS.map(item => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>原因类别</span>
                <select
                  value={reasonCategory}
                  onChange={event =>
                    setReasonCategory(event.currentTarget.value as MembershipReviewReasonCategory)
                  }
                >
                  {REASONS[decision].map(item => (
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
              <button type="button" disabled={working} onClick={review}>
                {working ? '正在提交…' : '确认审核决定'}
              </button>
            </div>
            {transferTargets.length ? (
              <div className={ops.transferControls}>
                <select
                  aria-label="接手审核员"
                  value={targetReviewer}
                  onChange={event => setTargetReviewer(event.currentTarget.value)}
                >
                  <option value="">选择接手审核员</option>
                  {transferTargets.map(item => (
                    <option key={item.accountId} value={item.accountId}>
                      {item.displayName}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="转交原因"
                  value={transferReason}
                  maxLength={500}
                  placeholder="转交原因"
                  onChange={event => setTransferReason(event.currentTarget.value)}
                />
                <button type="button" disabled={working} onClick={offerTransfer}>
                  发起转交
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <p className={styles.assigned}>已由另一位审核员领取，避免重复处理。</p>
        )}
        <ReviewHistory application={application} />
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </footer>
    </article>
  )
}

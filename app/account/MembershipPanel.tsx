'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import { formatSiteNumericDateTime } from '@/lib/datetime'
import type { AccountOverview } from '@/lib/identity/account-overview'
import styles from './membership.module.css'

const DAY_MS = 24 * 60 * 60 * 1000

const STATUS_COPY = {
  draft: ['草稿', '资料尚未提交审核。'],
  pending: ['等待审核', '申请已进入审核队列。'],
  in_review: ['审核中', '审核员正在查看这份申请。'],
  changes_requested: ['需要补充资料', '请根据审核意见更新后重新提交。'],
  approved: ['已通过', '成员资格已经生效。'],
  suspended: ['资格已暂停', '成员资格暂时不可用于赛事报名。'],
  revoked: ['资格已撤销', '成员资格已结束；如有疑问请联系组织方。'],
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

function nextActionLabel(state: keyof typeof STATUS_COPY | undefined, reminderEligible: boolean) {
  if (!state || ['draft', 'rejected', 'withdrawn'].includes(state)) {
    return '填写资料并提交资格申请。'
  }
  if (state === 'changes_requested') return '更新资料并重新提交。'
  if (state === 'approved') return '资格已生效，可以提交赛事报名。'
  if (state === 'suspended') return '联系组织方确认恢复资格所需的信息。'
  if (state === 'revoked') return '如需重新取得资格，请联系组织方。'
  return reminderEligible ? '可以提醒审核员，或继续等待处理。' : '无需重复提交，请等待审核结果。'
}

function encodedForm(form: HTMLFormElement) {
  const encoded = new URLSearchParams()
  for (const [key, value] of new FormData(form)) {
    if (typeof value === 'string') encoded.append(key, value)
  }
  return encoded
}

interface CommandResponse {
  error?: string
  nextEligibleAt?: number
}

async function send(body: URLSearchParams) {
  const response = await fetch('/api/account/membership', {
    method: 'POST',
    body,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  const payload = (await response.json().catch(() => null)) as CommandResponse | null
  if (!response.ok) throw new Error(payload?.error ?? '暂时无法更新资格申请，请稍后重试。')
  return payload
}

export function MembershipPanel({
  membership,
  now,
  lastReminderAt,
}: {
  membership: AccountOverview['membership']
  now: number
  lastReminderAt: number | null
}) {
  const router = useRouter()
  const [clockNow, setClockNow] = useState(now)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [confirmingWithdrawal, setConfirmingWithdrawal] = useState(false)
  const [nextReminderAt, setNextReminderAt] = useState(
    lastReminderAt === null ? null : lastReminderAt + DAY_MS,
  )
  const application = membership.application
  const state = membership.status ?? application?.status
  const editable = !state || ['draft', 'changes_requested', 'rejected', 'withdrawn'].includes(state)

  useEffect(() => {
    const updateClock = () => setClockNow(current => Math.max(current, now, Date.now()))
    const initialTimer = window.setTimeout(updateClock, 0)
    const interval = window.setInterval(updateClock, 30_000)
    const handleVisibility = () => {
      if (!document.hidden) updateClock()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', updateClock)
    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', updateClock)
    }
  }, [now])

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
      const result = await send(
        new URLSearchParams({
          operation,
          applicationId: application.id,
          revision: String(application.revision),
          identityClaim: '',
          contact: '',
          reason: '',
        }),
      )
      if (operation === 'remind' && result?.nextEligibleAt) {
        setNextReminderAt(result.nextEligibleAt)
      }
      setConfirmingWithdrawal(false)
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '暂时无法更新资格申请，请稍后重试。')
    } finally {
      setWorking(false)
    }
  }

  const submittedAt = application?.submittedAt ?? null
  const liveNow = Math.max(now, clockNow)
  const overdue = Boolean(submittedAt && liveNow - submittedAt >= DAY_MS)
  const reminderEligible = overdue && (nextReminderAt === null || liveNow >= nextReminderAt)
  const nextAction = nextActionLabel(state, reminderEligible)

  return (
    <section id="membership" className={styles.panel} aria-labelledby="membership-title">
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
      <p className={styles.nextAction}>
        <strong>下一步：</strong>
        {nextAction}
      </p>

      {submittedAt && ['pending', 'in_review'].includes(state ?? '') ? (
        <div className={styles.timeline}>
          <div>
            <small>提交时间</small>
            <strong>{formatSiteNumericDateTime(submittedAt)}</strong>
          </div>
          <div>
            <small>通常处理时间</small>
            <strong>24 小时内</strong>
          </div>
          <div>
            <small>已等待</small>
            <strong>{elapsedLabel(submittedAt, liveNow)}</strong>
          </div>
          <div>
            <small>最近更新</small>
            <strong>{formatSiteNumericDateTime(application?.updatedAt ?? submittedAt)}</strong>
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
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
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
          {nextReminderAt !== null && liveNow < nextReminderAt ? (
            <p>已发送提醒，下次可在 {formatSiteNumericDateTime(nextReminderAt)} 后再次提醒。</p>
          ) : null}
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          <div>
            {reminderEligible ? (
              <button type="button" disabled={working} onClick={() => void command('remind')}>
                提醒审核员
              </button>
            ) : null}
            {confirmingWithdrawal ? (
              <>
                <button type="button" disabled={working} onClick={() => void command('withdraw')}>
                  确定撤回
                </button>
                <button
                  type="button"
                  disabled={working}
                  onClick={() => setConfirmingWithdrawal(false)}
                >
                  保留申请
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={working}
                onClick={() => setConfirmingWithdrawal(true)}
              >
                撤回申请
              </button>
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}

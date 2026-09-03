'use client'

import { useMemo, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'
import { formatSiteNumericDateTime } from '@/lib/datetime'
import type {
  CheckInOperatorAssignment,
  TournamentCheckInOperatorManager,
} from '@/lib/queries/admin/tournament-staff'
import { grantCheckInOperator, revokeCheckInOperator } from '../../../actions/tournament-staff'
import { ManagerFeedback, type ManagerFeedbackState } from './ManagerFeedback'
import styles from './manager.module.css'

const ACCESS_WINDOWS = [
  { hours: 8, label: '本次值班 · 8 小时' },
  { hours: 24, label: '完整赛日 · 24 小时' },
  { hours: 168, label: '赛事周 · 7 天' },
] as const

function timeLabel(value: number | null) {
  if (value === null) return '未设置自动到期'
  return formatSiteNumericDateTime(value) ?? '时间记录不可用'
}

function AssignmentState({ assignment }: { assignment: CheckInOperatorAssignment }) {
  const state = assignment.active ? 'active' : assignment.revokedAt !== null ? 'revoked' : 'expired'
  const label = state === 'active' ? '值班中' : state === 'revoked' ? '已撤销' : '已到期'
  return (
    <span className={styles.state} data-state={state}>
      <i aria-hidden="true" /> {label}
    </span>
  )
}

function PersonLabel({ assignment }: { assignment: CheckInOperatorAssignment }) {
  return (
    <div className={styles.person}>
      <span className={styles.personMark} aria-hidden="true">
        {assignment.team?.tag.slice(0, 3).toUpperCase() ?? 'ID'}
      </span>
      <div>
        <strong>
          {assignment.team
            ? `[${assignment.team.tag}] ${assignment.team.name}`
            : '报名归属已不可用'}
        </strong>
        <span>
          {assignment.team
            ? `报名队长 ${assignment.team.captain} · ${assignment.reference}`
            : `账号索引 ${assignment.reference}`}
        </span>
      </div>
    </div>
  )
}

export function CheckInOperatorManager({ manager }: { manager: TournamentCheckInOperatorManager }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [selectedPrincipal, setSelectedPrincipal] = useState('')
  const [durationHours, setDurationHours] = useState(8)
  const [armedPrincipal, setArmedPrincipal] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<ManagerFeedbackState | null>(null)
  const assignmentsByPrincipal = useMemo(
    () => new Map(manager.assignments.map(assignment => [assignment.principalId, assignment])),
    [manager.assignments],
  )
  const grantableCandidates = manager.candidates.filter(
    candidate => !assignmentsByPrincipal.get(candidate.principalId)?.active,
  )
  const activeCount = manager.assignments.filter(assignment => assignment.active).length

  function clearOperationIntent() {
    setSelectedPrincipal('')
    setArmedPrincipal(null)
  }

  function cancelRevoke(principalId: string) {
    setArmedPrincipal(null)
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-revoke-principal="${principalId}"]`)?.focus()
    })
  }

  function submitGrant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedPrincipal || pending) return
    const existing = assignmentsByPrincipal.get(selectedPrincipal)
    setFeedback(null)
    startTransition(async () => {
      try {
        const result = await grantCheckInOperator(
          manager.tournament.id,
          selectedPrincipal,
          durationHours,
          existing?.snapshot ?? null,
        )
        if (!result.ok) {
          setFeedback({ ok: false, message: result.error, scope: 'grant' })
          if (result.code === 'conflict') {
            clearOperationIntent()
            router.refresh()
          }
          return
        }
        clearOperationIntent()
        setFeedback({
          ok: true,
          message: `签到权限已开放，将于 ${timeLabel(result.assignment.expiresAt)} 自动结束。`,
          scope: 'grant',
        })
        router.refresh()
      } catch {
        setFeedback({ ok: false, message: '网络异常，权限没有改变。', scope: 'grant' })
      }
    })
  }

  function submitRevoke(assignment: CheckInOperatorAssignment) {
    if (pending) return
    setFeedback(null)
    startTransition(async () => {
      try {
        const result = await revokeCheckInOperator(
          manager.tournament.id,
          assignment.principalId,
          assignment.snapshot,
        )
        if (!result.ok) {
          setFeedback({ ok: false, message: result.error, scope: 'ledger' })
          if (result.code === 'conflict') {
            clearOperationIntent()
            router.refresh()
          }
          return
        }
        clearOperationIntent()
        setFeedback({
          ok: true,
          message: '这条签到员授权已撤销；对方从其他职责继承的权限不受影响。',
          scope: 'ledger',
        })
        router.refresh()
      } catch {
        setFeedback({ ok: false, message: '网络异常，权限没有改变。', scope: 'ledger' })
      }
    })
  }

  return (
    <section
      className={styles.manager}
      aria-labelledby="operator-manager-title"
      aria-busy={pending}
    >
      <header className={styles.managerHeader}>
        <div>
          <p>ACCESS DESK / 授权台</p>
          <h2 id="operator-manager-title">现场签到员</h2>
        </div>
        <div className={styles.count} aria-label={`当前 ${activeCount} 条签到员临时授权有效`}>
          <strong>{String(activeCount).padStart(2, '0')}</strong>
          <span>
            ACTIVE
            <br />
            当班账号
          </span>
        </div>
      </header>

      <div className={styles.managerGrid}>
        <form className={styles.grant} onSubmit={submitGrant} aria-labelledby="grant-title">
          <div className={styles.sectionNumber} aria-hidden="true">
            01
          </div>
          <div>
            <h3 id="grant-title">开放一次临时值班</h3>
            <p>
              候选来自本届已绑定的报名档案。请让当事人从“我的赛事”报出 PASS
              编号；队名只用于定位报名，不代表已核验持有人身份。
            </p>
          </div>

          <label>
            选择已绑定报名
            <select
              value={selectedPrincipal}
              onChange={event => setSelectedPrincipal(event.target.value)}
              disabled={pending || grantableCandidates.length === 0}
              required
            >
              <option value="">请选择报名档案</option>
              {grantableCandidates.map(candidate => (
                <option key={candidate.principalId} value={candidate.principalId}>
                  {candidate.reference} · [{candidate.team.tag}] {candidate.team.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            自动结束
            <select
              value={durationHours}
              onChange={event => setDurationHours(Number(event.target.value))}
              disabled={pending}
            >
              {ACCESS_WINDOWS.map(window => (
                <option key={window.hours} value={window.hours}>
                  {window.label}
                </option>
              ))}
            </select>
          </label>

          <Button type="submit" variant="primary" disabled={pending || !selectedPrincipal}>
            {pending ? '正在确认…' : '开放签到权限'}
          </Button>

          {feedback?.scope === 'grant' ? <ManagerFeedback feedback={feedback} /> : null}

          {grantableCandidates.length === 0 ? (
            <p className={styles.emptyHint}>
              暂无可授权报名。持有人需先通过报名回执建立赛事通行；已有权限者列在右侧。
            </p>
          ) : null}
        </form>

        <section className={styles.ledger} aria-labelledby="access-ledger-title">
          <div className={styles.ledgerHeading}>
            <div>
              <span>02</span>
              <h3 id="access-ledger-title">本届授权记录</h3>
            </div>
            <small>最新状态，不是审计日志</small>
          </div>

          {feedback?.scope === 'ledger' ? <ManagerFeedback feedback={feedback} /> : null}

          {manager.assignments.length === 0 ? (
            <div className={styles.emptyLedger}>
              <strong>还没有签到员</strong>
              <p>开放后，账号、有效期与当前状态会出现在这里。</p>
            </div>
          ) : (
            <ul className={styles.assignmentList}>
              {manager.assignments.map(assignment => {
                const armed = armedPrincipal === assignment.principalId
                return (
                  <li key={assignment.principalId}>
                    <div className={styles.assignmentTop}>
                      <PersonLabel assignment={assignment} />
                      <AssignmentState assignment={assignment} />
                    </div>
                    <dl className={styles.assignmentMeta}>
                      <div>
                        <dt>账号</dt>
                        <dd>{assignment.reference}</dd>
                      </div>
                      <div>
                        <dt>开放于</dt>
                        <dd>{timeLabel(assignment.grantedAt)}</dd>
                      </div>
                      <div>
                        <dt>结束于</dt>
                        <dd>{timeLabel(assignment.expiresAt)}</dd>
                      </div>
                    </dl>
                    {assignment.active ? (
                      <div className={styles.revoke} data-armed={armed || undefined}>
                        {armed ? (
                          <>
                            <p>撤销后，这条临时授权立即失效；其他职责继承不受影响。确认吗？</p>
                            <div>
                              <Button
                                autoFocus
                                type="button"
                                size="mini"
                                variant="danger"
                                disabled={pending}
                                onClick={() => submitRevoke(assignment)}
                              >
                                确认撤销
                              </Button>
                              <Button
                                type="button"
                                size="mini"
                                disabled={pending}
                                onClick={() => cancelRevoke(assignment.principalId)}
                              >
                                保留权限
                              </Button>
                            </div>
                          </>
                        ) : (
                          <Button
                            type="button"
                            size="mini"
                            disabled={pending}
                            data-revoke-principal={assignment.principalId}
                            aria-label={`撤销 ${assignment.team ? `[${assignment.team.tag}] ${assignment.team.name}` : assignment.reference} 的签到权限`}
                            onClick={() => setArmedPrincipal(assignment.principalId)}
                          >
                            撤销权限
                          </Button>
                        )}
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </section>
  )
}

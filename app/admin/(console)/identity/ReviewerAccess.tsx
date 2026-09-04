'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  GRANTABLE_IDENTITY_ROLES,
  type ManagedIdentityRole,
  type ManagedRoleAssignment,
} from '@/lib/identity/role-contract'
import { postIdentityForm } from './identity-command'
import styles from './identity.module.css'
import ops from './operations.module.css'

const emptyFields = {
  operation: '',
  username: '',
  role: '',
  tournamentId: '',
  assignmentId: '',
  revision: '',
  reason: '',
}

const ROLE_LABEL: Record<ManagedIdentityRole, string> = {
  identity_reviewer: '资格审核员',
  organizer: '赛事组织者',
  referee: '裁判',
  check_in_operator: '签到操作员',
}

export function ReviewerAccess({
  assignments,
  tournaments,
  total,
}: {
  assignments: readonly ManagedRoleAssignment[]
  tournaments: readonly { id: number; title: string }[]
  total: number
}) {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [role, setRole] = useState<ManagedIdentityRole>('identity_reviewer')
  const [tournamentId, setTournamentId] = useState('')
  const [grantReason, setGrantReason] = useState('负责赛事运营工作')
  const [revokeId, setRevokeId] = useState('')
  const [revokeReason, setRevokeReason] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  async function run(values: Record<string, string>) {
    setWorking(true)
    setError('')
    try {
      await postIdentityForm('/api/admin/identity/roles', { ...emptyFields, ...values })
      setUsername('')
      setRevokeId('')
      setRevokeReason('')
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '权限操作没有完成。')
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className={ops.accessPanel} aria-labelledby="role-access-title">
      <div className={ops.sectionHeading}>
        <div>
          <p>PEOPLE / ACCESS</p>
          <h2 id="role-access-title">人员与权限</h2>
        </div>
        <span>{total} 项有效授权</span>
      </div>
      <form
        className={ops.accessForm}
        onSubmit={event => {
          event.preventDefault()
          void run({
            operation: 'grant',
            username,
            role,
            tournamentId: role === 'identity_reviewer' ? '' : tournamentId,
            reason: grantReason,
          })
        }}
      >
        <label>
          <span>账号用户名</span>
          <input
            value={username}
            minLength={3}
            maxLength={32}
            autoComplete="off"
            placeholder="member.name"
            required
            onChange={event => setUsername(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>角色</span>
          <select
            value={role}
            onChange={event => setRole(event.currentTarget.value as ManagedIdentityRole)}
          >
            {GRANTABLE_IDENTITY_ROLES.map(value => (
              <option key={value} value={value}>
                {ROLE_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        {role !== 'identity_reviewer' ? (
          <label>
            <span>赛事</span>
            <select
              value={tournamentId}
              required
              onChange={event => setTournamentId(event.currentTarget.value)}
            >
              <option value="">选择赛事</option>
              {tournaments.map(item => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          <span>授权原因</span>
          <input
            value={grantReason}
            minLength={3}
            maxLength={500}
            required
            onChange={event => setGrantReason(event.currentTarget.value)}
          />
        </label>
        <button disabled={working}>授予权限</button>
      </form>
      <div className={ops.accessList}>
        {assignments.map(item => (
          <article key={item.id}>
            <div>
              <strong>{item.displayName}</strong>
              <span>
                @{item.username ?? '无用户名'} · {ROLE_LABEL[item.role]}
                {item.tournamentTitle ? ` · ${item.tournamentTitle}` : ''}
              </span>
            </div>
            {revokeId === item.id ? (
              <form
                onSubmit={event => {
                  event.preventDefault()
                  void run({
                    operation: 'revoke',
                    assignmentId: item.id,
                    revision: String(item.revision),
                    reason: revokeReason,
                  })
                }}
              >
                <input
                  aria-label={`撤销 ${item.displayName} 的原因`}
                  value={revokeReason}
                  minLength={3}
                  maxLength={500}
                  placeholder="撤销原因"
                  required
                  onChange={event => setRevokeReason(event.currentTarget.value)}
                />
                <button disabled={working}>确认撤销</button>
                <button type="button" onClick={() => setRevokeId('')}>
                  取消
                </button>
              </form>
            ) : (
              <button type="button" onClick={() => setRevokeId(item.id)}>
                撤销
              </button>
            )}
          </article>
        ))}
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}

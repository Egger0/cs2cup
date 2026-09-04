'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { ApprovedMembershipItem } from '@/lib/identity/membership-service'
import { membershipFields, postIdentityForm } from './identity-command'
import styles from './identity.module.css'
import ops from './operations.module.css'

export function MembershipRoster({
  memberships,
  total,
  suspended,
}: {
  memberships: readonly ApprovedMembershipItem[]
  total: number
  suspended: number
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<{
    id: string
    operation: 'suspend' | 'restore' | 'revoke'
  } | null>(null)
  const [reason, setReason] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  function chooseOperation(id: string, operation: 'suspend' | 'restore' | 'revoke') {
    setReason('')
    setError('')
    setSelected({ id, operation })
  }

  function cancelOperation() {
    setSelected(null)
    setReason('')
    setError('')
  }

  async function change(item: ApprovedMembershipItem) {
    if (!selected) return
    setWorking(true)
    setError('')
    try {
      await postIdentityForm(
        '/api/admin/identity/membership',
        membershipFields({
          operation: `membership_${selected.operation}`,
          membershipId: item.id,
          revision: String(item.revision),
          reason,
        }),
      )
      setSelected(null)
      setReason('')
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '成员资格操作没有完成。')
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className={ops.roster} aria-labelledby="membership-roster-title">
      <div className={ops.sectionHeading}>
        <div>
          <p>MEMBERSHIP / ACTIVE</p>
          <h2 id="membership-roster-title">有效成员资格</h2>
        </div>
        <span>
          {total} 人 · 暂停 {suspended}
        </span>
      </div>
      {!memberships.length ? <p className={styles.empty}>当前没有有效成员资格。</p> : null}
      <div className={ops.rosterList}>
        {memberships.map(item => (
          <article key={item.id}>
            <div>
              <strong>{item.displayName}</strong>
              <span>
                @{item.username ?? '无用户名'} ·{' '}
                {item.status === 'suspended' ? '资格已暂停' : '资格有效'}
              </span>
              {item.statusChangeReason ? <small>{item.statusChangeReason}</small> : null}
            </div>
            {selected?.id === item.id ? (
              <form
                onSubmit={event => {
                  event.preventDefault()
                  void change(item)
                }}
              >
                <input
                  aria-label={`变更 ${item.displayName} 成员资格的原因`}
                  value={reason}
                  minLength={3}
                  maxLength={1000}
                  placeholder={selected.operation === 'restore' ? '说明恢复原因' : '说明变更原因'}
                  required
                  onChange={event => setReason(event.currentTarget.value)}
                />
                <button disabled={working}>
                  确认
                  {selected.operation === 'restore'
                    ? '恢复'
                    : selected.operation === 'suspend'
                      ? '暂停'
                      : '撤销'}
                </button>
                <button type="button" disabled={working} onClick={cancelOperation}>
                  取消
                </button>
              </form>
            ) : (
              <div className={ops.rowActions}>
                <button
                  type="button"
                  onClick={() =>
                    chooseOperation(item.id, item.status === 'suspended' ? 'restore' : 'suspend')
                  }
                >
                  {item.status === 'suspended' ? '恢复资格' : '暂停资格'}
                </button>
                <button type="button" onClick={() => chooseOperation(item.id, 'revoke')}>
                  永久撤销
                </button>
              </div>
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

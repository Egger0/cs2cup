'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition, type FormEvent } from 'react'

import { Button } from '@/components/ui'
import type {
  RegistrationCollaborator,
  RegistrationInvitation,
} from '@/lib/identity/registration-workflow'
import {
  cancelRegistrationInvitation,
  deleteAccountRegistration,
  inviteRegistrationAccount,
  removeRegistrationCollaborator,
} from './actions'
import styles from './registration-access.module.css'

interface Feedback {
  ok: boolean
  message: string
  reauthenticate?: boolean
}

export function RegistrationAccessPanel({
  teamId,
  relationship,
  managers,
  invitations,
  deletable,
}: {
  teamId: number
  relationship: 'owner' | 'manager'
  managers: RegistrationCollaborator[]
  invitations: RegistrationInvitation[]
  deletable: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  function run(
    work: () => Promise<{ ok: boolean; error?: string; reauthenticate?: boolean }>,
    success: string,
  ) {
    setFeedback(null)
    startTransition(async () => {
      const result = await work().catch(() => ({
        ok: false,
        error: '网络异常，请稍后重试。',
        reauthenticate: undefined,
      }))
      setFeedback({
        ok: result.ok,
        message: result.ok ? success : (result.error ?? '操作失败，请稍后重试。'),
        reauthenticate: result.reauthenticate,
      })
      if (result.ok) router.refresh()
    })
  }

  function invite(event: FormEvent<HTMLFormElement>, nextRelationship: 'owner' | 'manager') {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    if (
      nextRelationship === 'owner' &&
      !window.confirm('对方接受后将成为新所有者，你会保留协作者权限。确定发起转让吗？')
    ) {
      return
    }
    run(
      () => inviteRegistrationAccount(teamId, nextRelationship, values),
      nextRelationship === 'owner' ? '所有权转让邀请已发出。' : '协作者邀请已发出。',
    )
    form.reset()
  }

  if (relationship === 'manager') {
    return (
      <section className={styles.panel} aria-labelledby="access-title">
        <p className={styles.eyebrow}>ACCESS / 协作权限</p>
        <h2 id="access-title">你是协作者</h2>
        <p>可以查看和修改报名；邀请成员、转让所有权及取消报名由所有者处理。</p>
      </section>
    )
  }

  return (
    <section className={styles.panel} aria-labelledby="access-title" aria-busy={pending}>
      <p className={styles.eyebrow}>ACCESS / 协作权限</p>
      <h2 id="access-title">协作者与所有权</h2>
      <p className={styles.lede}>使用对方的账号用户名邀请；权限只有在对方接受后才会生效。</p>

      {feedback ? (
        <div
          className={feedback.ok ? styles.success : styles.error}
          role={feedback.ok ? 'status' : 'alert'}
        >
          <span>{feedback.message}</span>
          {feedback.reauthenticate ? (
            <Link href="/login?reauth=1&redirectKey=account">重新登录</Link>
          ) : null}
        </div>
      ) : null}

      <div className={styles.columns}>
        <div>
          <h3>当前协作者</h3>
          {managers.length ? (
            <ul className={styles.people}>
              {managers.map(manager => (
                <li key={manager.membershipId}>
                  <span>
                    <strong>{manager.displayName}</strong>
                    <small>{manager.username ? `@${manager.username}` : '迁移账号'}</small>
                  </span>
                  <Button
                    type="button"
                    size="mini"
                    disabled={pending}
                    onClick={() => {
                      if (!window.confirm(`移除 ${manager.displayName} 的报名协作权限？`)) return
                      run(
                        () => removeRegistrationCollaborator(teamId, manager.membershipId),
                        '协作者已移除。',
                      )
                    }}
                  >
                    移除
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>尚未添加协作者。</p>
          )}
          <form onSubmit={event => invite(event, 'manager')} className={styles.inviteForm}>
            <label htmlFor="manager-username">邀请协作者</label>
            <div>
              <input
                id="manager-username"
                name="username"
                placeholder="账号用户名"
                autoComplete="off"
                required
                minLength={3}
                maxLength={32}
              />
              <Button type="submit" size="mini" disabled={pending}>
                发送邀请
              </Button>
            </div>
          </form>
        </div>

        <div>
          <h3>待处理邀请</h3>
          {invitations.length ? (
            <ul className={styles.people}>
              {invitations.map(item => (
                <li key={item.id}>
                  <span>
                    <strong>{item.accountName}</strong>
                    <small>
                      {item.username ? `@${item.username} · ` : ''}
                      {item.relationship === 'owner' ? '所有权转让' : '协作者'}
                    </small>
                  </span>
                  <Button
                    type="button"
                    size="mini"
                    disabled={pending}
                    onClick={() =>
                      run(() => cancelRegistrationInvitation(teamId, item.id), '邀请已取消。')
                    }
                  >
                    取消
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.empty}>没有待处理邀请。</p>
          )}
          <form onSubmit={event => invite(event, 'owner')} className={styles.inviteForm}>
            <label htmlFor="owner-username">转让所有权</label>
            <div>
              <input
                id="owner-username"
                name="username"
                placeholder="新所有者用户名"
                autoComplete="off"
                required
                minLength={3}
                maxLength={32}
              />
              <Button type="submit" size="mini" disabled={pending}>
                发起转让
              </Button>
            </div>
          </form>
        </div>
      </div>

      <div className={styles.danger}>
        <div>
          <strong>取消这份报名</strong>
          <p>
            {deletable ? '仅等待审核的报名可以取消。' : '报名已审核或锁定，请联系赛事负责人处理。'}
          </p>
        </div>
        <Button
          type="button"
          variant="danger"
          disabled={pending || !deletable}
          onClick={() => {
            if (!window.confirm('确定永久取消这份报名？阵容与协作权限会一起删除。')) return
            run(async () => {
              const result = await deleteAccountRegistration(teamId)
              if (result.ok) router.replace('/me')
              return result
            }, '报名已取消。')
          }}
        >
          取消报名
        </Button>
      </div>
    </section>
  )
}

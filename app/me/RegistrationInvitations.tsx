'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui'
import type { RegistrationInvitation } from '@/lib/identity/registration-workflow'
import { acceptRegistrationAccessInvitation } from './registrations/actions'
import styles from './registration-invitations.module.css'

export function RegistrationInvitations({ items }: { items: RegistrationInvitation[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{
    ok: boolean
    message: string
    reauthenticate?: boolean
  } | null>(null)
  if (!items.length) return null

  return (
    <section
      className={styles.panel}
      aria-labelledby="registration-invitations"
      aria-busy={pending}
    >
      <header>
        <p>INVITATIONS / 待处理</p>
        <h2 id="registration-invitations">报名协作邀请</h2>
      </header>
      {feedback ? (
        <p
          className={feedback.ok ? styles.success : styles.error}
          role={feedback.ok ? 'status' : 'alert'}
        >
          {feedback.message}
          {feedback.reauthenticate ? (
            <Link href="/login?reauth=1&redirectKey=account">重新登录</Link>
          ) : null}
        </p>
      ) : null}
      <ul>
        {items.map(item => (
          <li key={item.id}>
            <div>
              <small>{item.tournamentTitle}</small>
              <strong>
                [{item.teamTag}] {item.teamName}
              </strong>
              <span>
                {item.inviterName} 邀请你成为
                {item.relationship === 'owner' ? '新所有者' : '协作者'}
              </span>
            </div>
            <Button
              type="button"
              size="mini"
              variant="primary"
              disabled={pending}
              onClick={() => {
                if (
                  item.relationship === 'owner' &&
                  !window.confirm('接受后你将成为报名所有者，并负责后续权限管理。确定接受吗？')
                ) {
                  return
                }
                setFeedback(null)
                startTransition(async () => {
                  const result = await acceptRegistrationAccessInvitation(item.id).catch(() => ({
                    ok: false,
                    error: '网络异常，请稍后重试。',
                    reauthenticate: undefined,
                  }))
                  setFeedback({
                    ok: result.ok,
                    message: result.ok
                      ? '邀请已接受，报名已加入你的账号。'
                      : (result.error ?? '接受失败。'),
                    reauthenticate: result.reauthenticate,
                  })
                  if (result.ok) router.refresh()
                })
              }}
            >
              接受邀请
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui'
import { attachManagedRegistration } from './actions'
import styles from './management.module.css'

export function LegacyRegistrationAttach({
  slug,
  token,
  teamId,
  signedIn,
  relationship,
  accountOwned,
  loginHref,
}: {
  slug: string
  token: string
  teamId: number
  signedIn: boolean
  relationship: 'owner' | 'manager' | null
  accountOwned: boolean
  loginHref: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState<{
    error: string
    reauthenticate?: boolean
  } | null>(null)

  if (relationship) {
    return (
      <aside className={styles.accountHandoff}>
        <span>ACCOUNT / 已关联</span>
        <div>
          <strong>这份报名已在你的账号中</strong>
          <p>后续查看、修改与协作权限都从“我的赛事”进入。</p>
        </div>
        <Link href={`/me/registrations/${teamId}`}>使用账号管理 →</Link>
      </aside>
    )
  }

  if (accountOwned) {
    return (
      <aside className={styles.accountHandoff}>
        <span>ACCOUNT / 已迁移</span>
        <div>
          <strong>这份报名已经迁移到账号</strong>
          <p>旧链接现仅保留只读状态；请由报名所有者登录后管理。</p>
        </div>
      </aside>
    )
  }

  if (!signedIn) {
    return (
      <aside className={styles.accountHandoff}>
        <span>MIGRATION / 一次完成</span>
        <div>
          <strong>把旧报名关联到账号</strong>
          <p>登录后确认一次即可；完成后不再需要保存或转发这条管理链接。</p>
        </div>
        <Link href={loginHref}>登录并继续 →</Link>
      </aside>
    )
  }

  return (
    <aside className={styles.accountHandoff} aria-busy={pending}>
      <span>MIGRATION / 待确认</span>
      <div>
        <strong>把旧报名关联到当前账号</strong>
        <p>确认后旧管理链接立即失效，当前账号成为报名所有者。</p>
        {feedback ? (
          <p className={styles.attachError} role="alert">
            {feedback.error}
            {feedback.reauthenticate ? <Link href={`${loginHref}&reauth=1`}>重新登录</Link> : null}
          </p>
        ) : null}
      </div>
      <Button
        type="button"
        variant="primary"
        disabled={pending}
        onClick={() => {
          if (!window.confirm('确认把这份报名永久关联到当前账号？旧管理链接会立即失效。')) return
          setFeedback(null)
          startTransition(async () => {
            const result = await attachManagedRegistration(slug, token).catch(() => ({
              ok: false,
              error: '网络异常，请稍后重试。',
              teamId: undefined,
              reauthenticate: undefined,
            }))
            if (!result.ok || !result.teamId) {
              setFeedback({
                error: result.error ?? '迁移失败，请稍后重试。',
                reauthenticate: result.reauthenticate,
              })
              return
            }
            router.replace(`/me/registrations/${result.teamId}`)
            router.refresh()
          })
        }}
      >
        {pending ? '正在关联…' : '确认关联账号'}
      </Button>
    </aside>
  )
}

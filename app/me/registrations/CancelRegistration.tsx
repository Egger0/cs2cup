'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui'
import { deleteAccountRegistration } from './actions'
import styles from './registration-access.module.css'

export function CancelRegistration({ teamId, deletable }: { teamId: number; deletable: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<{ message: string; reauthenticate?: boolean } | null>(null)

  return (
    <section className={styles.panel} aria-busy={pending}>
      {error ? (
        <div className={styles.error} role="alert">
          <span>{error.message}</span>
          {error.reauthenticate ? (
            <Link href="/login?reauth=1&redirectKey=account">重新登录</Link>
          ) : null}
        </div>
      ) : null}
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
            if (!window.confirm('确定永久取消这份报名？')) return
            setError(null)
            startTransition(async () => {
              const result = await deleteAccountRegistration(teamId).catch(() => ({
                ok: false as const,
                error: '网络异常，请稍后重试。',
                reauthenticate: undefined,
              }))
              if (result.ok) router.replace('/me')
              else
                setError({
                  message: result.error ?? '操作失败，请稍后重试。',
                  reauthenticate: result.reauthenticate,
                })
            })
          }}
        >
          取消报名
        </Button>
      </div>
    </section>
  )
}

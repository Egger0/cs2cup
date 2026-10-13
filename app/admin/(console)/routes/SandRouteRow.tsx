'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, ButtonLink } from '@/components/ui'
import type { SandPlan } from '@/lib/sand-routes'
import { reviewSandRoute } from '../actions/routes'
import styles from '../admin.module.css'

export function SandRouteRow({ plan, mapName }: { plan: SandPlan; mapName: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const review = (verdict: 'approve' | 'delete') =>
    startTransition(async () => {
      setError('')
      try {
        const result = await reviewSandRoute(plan.id, verdict)
        if (result.ok) router.refresh()
        else setError(result.error)
      } catch {
        setError('操作失败，请检查网络后重试。')
      }
    })

  return (
    <div className={styles.listRow}>
      <div>
        <div className={styles.listTitle}>{plan.title}</div>
        <div className={styles.listMeta}>
          {mapName} · {plan.author} · {plan.waypoints.length} 站
        </div>
        <ol className={styles.messageBody} style={{ paddingLeft: '1.4em' }}>
          {plan.waypoints.map(([, , note], index) => (
            <li key={index}>{note ?? '（这一站没写思路）'}</li>
          ))}
        </ol>
      </div>
      <div className={styles.rowActions}>
        <ButtonLink href={`/maps?map=${plan.mapId}&plan=${plan.id}`} size="mini">
          在沙盘里看
        </ButtonLink>
        {plan.approved ? null : (
          <Button
            size="mini"
            variant="primary"
            disabled={pending}
            onClick={() => review('approve')}
          >
            通过
          </Button>
        )}
        <Button
          size="mini"
          variant="danger"
          disabled={pending}
          onClick={() => {
            if (confirm(`删除「${plan.title}」？`)) review('delete')
          }}
        >
          删除
        </Button>
        {error ? (
          <span className={styles.error} role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  )
}

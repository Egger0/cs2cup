'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import type { DeltaMapSummary } from '@/lib/delta-sand'
import {
  ROUTE_STOPS,
  ROUTE_TITLE_LIMIT,
  routeMeters,
  type SandPlan,
  type Waypoint,
} from '@/lib/sand-routes'
import { submitSandRoute, type SandRouteSubmission } from './route-actions'
import tools from './SandTools.module.css'
import styles from './SandRoutes.module.css'

export function SandPlans({
  map,
  level,
  route,
  plans,
  plan,
  onPlan,
}: {
  map: DeltaMapSummary
  level: number
  route: Waypoint[]
  plans: SandPlan[]
  plan: number | null
  onPlan: (plan: SandPlan) => void
}) {
  const [title, setTitle] = useState('')
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<SandRouteSubmission | null>(null)

  return (
    <>
      {route.length >= ROUTE_STOPS.min && plan === null ? (
        <form
          className={styles.submit}
          onSubmit={event => {
            event.preventDefault()
            startTransition(async () => {
              try {
                const next = await submitSandRoute({
                  mapId: map.id,
                  level,
                  title,
                  waypoints: route,
                })
                setResult(next)
                if (next.ok) setTitle('')
              } catch {
                setResult({ ok: false, error: '投稿失败，请检查网络后重试。' })
              }
            })
          }}
        >
          <input
            value={title}
            required
            maxLength={ROUTE_TITLE_LIMIT}
            placeholder="给这条路线起个名字"
            aria-label="路线名"
            disabled={pending}
            onChange={event => setTitle(event.currentTarget.value)}
          />
          <button type="submit" disabled={pending}>
            {pending ? '投稿中' : '投稿路线'}
          </button>
          {result ? (
            <p role={result.ok ? 'status' : 'alert'} data-ok={result.ok}>
              {result.ok ? '已收到，审核通过后会出现在下面的社员路线里。' : result.error}
              {!result.ok && result.signIn ? <Link href="/login"> 去登录</Link> : null}
            </p>
          ) : null}
        </form>
      ) : null}

      <section className={tools.group}>
        <h3>
          社员路线
          <span>{plans.length}</span>
        </h3>
        {plans.length ? (
          plans.map(entry => (
            <button
              key={entry.id}
              type="button"
              className={styles.plan}
              aria-pressed={entry.id === plan}
              onClick={() => onPlan(entry)}
            >
              <b>
                {entry.title}
                {entry.approved ? null : <em>待审核</em>}
              </b>
              <small>
                {entry.author} · {map.levels[entry.level]?.replace(/[|｜]/, ' · ')} ·{' '}
                {entry.waypoints.length} 站 · {Math.round(routeMeters(entry.waypoints, map.meters))}{' '}
                米
              </small>
            </button>
          ))
        ) : (
          <p className={tools.empty}>这张图还没有社员路线。画一条，写上每站的思路，投上来。</p>
        )}
      </section>
    </>
  )
}

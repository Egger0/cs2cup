'use client'

import { useState } from 'react'
import type { DeltaMapSummary } from '@/lib/delta-sand'
import {
  ROUTE_NOTE_LIMIT,
  RUN_METERS_PER_SECOND,
  routeMeters,
  type SandPlan,
  type Waypoint,
} from '@/lib/sand-routes'
import { SandPlans } from './SandPlans'
import tools from './SandTools.module.css'
import styles from './SandRoutes.module.css'

const clock = (seconds: number) =>
  seconds < 60
    ? `${Math.round(seconds)} 秒`
    : `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`

export function SandRoute({
  map,
  level,
  routing,
  route,
  stop,
  plans,
  plan,
  onRouting,
  onRoute,
  onStop,
  onPlan,
}: {
  map: DeltaMapSummary
  level: number
  routing: boolean
  route: Waypoint[]
  stop: number | null
  plans: SandPlan[]
  plan: number | null
  onRouting: (routing: boolean) => void
  onRoute: (route: Waypoint[]) => void
  onStop: (index: number) => void
  onPlan: (plan: SandPlan) => void
}) {
  const [copied, setCopied] = useState(false)
  const distance = routeMeters(route, map.meters)
  const at = stop !== null && stop < route.length ? stop : null
  const annotate = (index: number, note: string) =>
    onRoute(route.map((point, other) => (other === index ? [point[0], point[1], note] : point)))

  return (
    <div className={tools.stack}>
      <div className={tools.readout}>
        <b>{Math.round(distance)}</b>
        <span>米</span>
        <p>
          {route.length > 1
            ? `奔跑约 ${clock(distance / RUN_METERS_PER_SECOND)}，${route.length} 站`
            : '在沙盘上依次点出每一站，再给每站写上搜什么、怎么走。'}
        </p>
      </div>
      <div className={tools.actions}>
        <button
          type="button"
          className={tools.primary}
          aria-pressed={routing}
          onClick={() => onRouting(!routing)}
        >
          {routing ? '完成规划' : route.length ? '继续加站' : '开始规划'}
        </button>
        <button type="button" disabled={!route.length} onClick={() => onRoute(route.slice(0, -1))}>
          撤销一步
        </button>
        <button type="button" disabled={!route.length} onClick={() => onRoute([])}>
          清空
        </button>
        <button
          type="button"
          disabled={route.length < 2}
          onClick={() =>
            void navigator.clipboard.writeText(location.href).then(() => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1800)
            })
          }
        >
          {copied ? '链接已复制' : '复制路线链接'}
        </button>
      </div>

      {route.length ? (
        <>
          <div className={styles.player}>
            <button type="button" disabled={!at} onClick={() => onStop((at ?? 1) - 1)}>
              上一站
            </button>
            <span>
              {at === null ? `共 ${route.length} 站` : `第 ${at + 1} / ${route.length} 站`}
            </span>
            <button
              type="button"
              disabled={at === route.length - 1}
              onClick={() => onStop(at === null ? 0 : at + 1)}
            >
              {at === null ? '从第 1 站看起' : '下一站'}
            </button>
          </div>
          <ol className={styles.stops}>
            {route.map(([x, y, note], index) => (
              <li key={index} data-active={index === at || undefined}>
                <button
                  type="button"
                  aria-pressed={index === at}
                  aria-label={`看第 ${index + 1} 站`}
                  onClick={() => onStop(index)}
                >
                  {index + 1}
                </button>
                <input
                  value={note ?? ''}
                  maxLength={ROUTE_NOTE_LIMIT}
                  placeholder={index ? '这一站搜什么、怎么走' : '出生后先做什么'}
                  aria-label={`第 ${index + 1} 站的思路`}
                  onFocus={() => index !== at && onStop(index)}
                  onChange={event => annotate(index, event.currentTarget.value)}
                />
                <small>
                  {index
                    ? `+${Math.round(Math.hypot(x - route[index - 1]![0], y - route[index - 1]![1]) * map.meters)} 米`
                    : '起点'}
                </small>
              </li>
            ))}
          </ol>
        </>
      ) : null}

      <SandPlans map={map} level={level} route={route} plans={plans} plan={plan} onPlan={onPlan} />
      <p className={tools.empty}>奔跑时间按 5 m/s 估算，只算水平距离。</p>
    </div>
  )
}

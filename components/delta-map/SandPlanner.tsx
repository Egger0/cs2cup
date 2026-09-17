'use client'

import { useState, type CSSProperties } from 'react'
import { SAND_KINDS, type DeltaMapData, type SandPoint } from '@/lib/delta-sand'
import type { Waypoint } from './SandTable'
import styles from './SandTools.module.css'

const RUN = 5

export const routeMeters = (route: Waypoint[], meters: number) =>
  route.reduce(
    (sum, [x, y], index) =>
      index ? sum + Math.hypot(x - route[index - 1]![0], y - route[index - 1]![1]) * meters : 0,
    0,
  )

const clock = (seconds: number) =>
  seconds < 60
    ? `${Math.round(seconds)} 秒`
    : `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`

export function SandFloors({
  data,
  points,
  building,
  floor,
  onBuilding,
}: {
  data: DeltaMapData
  points: SandPoint[]
  building: number | null
  floor: string | null
  onBuilding: (index: number | null, floor: string | null) => void
}) {
  const current = building === null ? null : data.buildings[building]
  return (
    <div className={styles.group}>
      <h3>室内楼层</h3>
      <div className={styles.buildings}>
        {data.buildings.map((entry, index) => (
          <button
            key={entry.name}
            type="button"
            aria-pressed={index === building}
            onClick={() =>
              onBuilding(
                index === building ? null : index,
                index === building ? null : entry.floors[0]!,
              )
            }
          >
            {entry.name}
            <small>{entry.floors.length} 层</small>
          </button>
        ))}
      </div>
      {current ? (
        <div className={styles.floors} role="group" aria-label={`${current.name} 楼层`}>
          {[...current.floors].reverse().map(code => (
            <button
              key={code}
              type="button"
              aria-pressed={code === floor}
              onClick={() => onBuilding(building, code)}
            >
              <b>{code}</b>
              <small>
                {points.filter(point => point[6] === `${building}:${code}`).length} 个点位
              </small>
            </button>
          ))}
          <button type="button" className={styles.surface} onClick={() => onBuilding(null, null)}>
            回到地表
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function SandRoute({
  meters,
  routing,
  route,
  onRouting,
  onRoute,
}: {
  meters: number
  routing: boolean
  route: Waypoint[]
  onRouting: (routing: boolean) => void
  onRoute: (route: Waypoint[]) => void
}) {
  const [copied, setCopied] = useState(false)
  const distance = routeMeters(route, meters)
  return (
    <div className={styles.group}>
      <h3>路线与测距</h3>
      <div className={styles.route}>
        <button type="button" aria-pressed={routing} onClick={() => onRouting(!routing)}>
          {routing ? '完成规划' : '规划路线'}
        </button>
        {route.length ? (
          <>
            <p>
              <b>{Math.round(distance)} m</b>
              <span>
                奔跑约 {clock(distance / RUN)} · {route.length} 个点
              </span>
            </p>
            <div className={styles.routeTools}>
              <button type="button" onClick={() => onRoute(route.slice(0, -1))}>
                撤销
              </button>
              <button type="button" onClick={() => onRoute([])}>
                清空
              </button>
              <button
                type="button"
                onClick={() =>
                  void navigator.clipboard.writeText(location.href).then(() => {
                    setCopied(true)
                    window.setTimeout(() => setCopied(false), 1800)
                  })
                }
              >
                {copied ? '已复制' : '复制路线链接'}
              </button>
            </div>
          </>
        ) : (
          <p className={styles.hintText}>
            {routing ? '在沙盘上依次点出途经点。' : '量距离、排跑图路线，链接可以直接发到群里。'}
          </p>
        )}
      </div>
    </div>
  )
}

export function SandPicked({
  selected,
  points,
  meters,
  onPoint,
  onRoute,
  onClear,
}: {
  selected: SandPoint
  points: SandPoint[]
  meters: number
  onPoint: (point: SandPoint) => void
  onRoute: (route: Waypoint[]) => void
  onClear: () => void
}) {
  const nearest =
    selected[0] === 'spawn'
      ? points
          .filter(point => point[0] === 'exit' && !point[6])
          .map(point => ({
            point,
            distance: Math.hypot(point[1] - selected[1], point[2] - selected[2]) * meters,
          }))
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 4)
      : []
  return (
    <div
      className={styles.selected}
      style={{ '--tone': SAND_KINDS[selected[0]].color } as CSSProperties}
    >
      <small>{SAND_KINDS[selected[0]].label}</small>
      <b>{selected[3]}</b>
      {selected[4] ? <p>{selected[4]}</p> : null}
      {selected[7]?.length ? (
        <p className={styles.link}>光柱连线指向联动位置，需先到那里开启</p>
      ) : null}
      {nearest.length ? (
        <ol className={styles.nearest}>
          {nearest.map(({ point, distance }, index) => (
            <li key={index}>
              <button type="button" onClick={() => onPoint(point)}>
                {point[3]}
                <small>
                  {Math.round(distance)} m · {point[4]}
                </small>
              </button>
              <button
                type="button"
                className={styles.go}
                onClick={() =>
                  onRoute([
                    [selected[1], selected[2]],
                    [point[1], point[2]],
                  ])
                }
              >
                连线
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      <button type="button" className={styles.dismiss} onClick={onClear}>
        取消选中
      </button>
    </div>
  )
}

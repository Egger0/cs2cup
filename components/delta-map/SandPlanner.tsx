'use client'

import { useState } from 'react'
import { SAND_KINDS, type DeltaMapData, type SandKind, type SandPoint } from '@/lib/delta-sand'
import { SandIcon } from './SandIcon'
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

export function PointRow({
  point,
  active,
  detail,
  onPoint,
}: {
  point: SandPoint
  active: boolean
  detail?: string
  onPoint: (point: SandPoint) => void
}) {
  return (
    <button
      type="button"
      className={styles.row}
      aria-pressed={active}
      onClick={() => onPoint(point)}
    >
      <SandIcon icon={point[5]} kind={point[0]} size={28} />
      <span>
        <b>{point[3]}</b>
        <small>{detail ?? point[4]}</small>
      </span>
    </button>
  )
}

export function SandFloors({
  data,
  points,
  building,
  floor,
  selected,
  onBuilding,
  onPoint,
}: {
  data: DeltaMapData
  points: SandPoint[]
  building: number | null
  floor: string | null
  selected: SandPoint | null
  onBuilding: (index: number | null, floor: string | null) => void
  onPoint: (point: SandPoint) => void
}) {
  const current = building === null ? null : data.buildings[building]
  const own = points.filter(point => point[6] === `${building}:${floor}`)
  const groups = (Object.keys(SAND_KINDS) as SandKind[])
    .map(kind => [kind, own.filter(point => point[0] === kind)] as const)
    .filter(([, list]) => list.length)
  return (
    <div className={styles.stack}>
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
        <>
          <div className={styles.floors} role="group" aria-label={`${current.name}楼层`}>
            {[...current.floors].reverse().map(code => (
              <button
                key={code}
                type="button"
                aria-pressed={code === floor}
                onClick={() => onBuilding(building, code)}
              >
                {code}
                <small>{points.filter(point => point[6] === `${building}:${code}`).length}</small>
              </button>
            ))}
            <button type="button" className={styles.surface} onClick={() => onBuilding(null, null)}>
              回到地表
            </button>
          </div>
          {groups.length ? (
            groups.map(([kind, list]) => (
              <section key={kind} className={styles.group}>
                <h3>
                  {SAND_KINDS[kind].label}
                  <span>{list.length}</span>
                </h3>
                {list.map((point, index) => (
                  <PointRow
                    key={index}
                    point={point}
                    active={selected === point}
                    onPoint={onPoint}
                  />
                ))}
              </section>
            ))
          ) : (
            <p className={styles.empty}>这一层官方没有标注点位。</p>
          )}
        </>
      ) : (
        <p className={styles.empty}>选一栋建筑，楼层会在沙盘上逐层展开。</p>
      )}
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
    <div className={styles.stack}>
      <div className={styles.readout}>
        <b>{Math.round(distance)}</b>
        <span>米</span>
        <p>
          {route.length > 1
            ? `奔跑约 ${clock(distance / RUN)}，${route.length} 个途经点`
            : '在沙盘上依次点出途经点，距离和奔跑时间会实时算出来。'}
        </p>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          aria-pressed={routing}
          onClick={() => onRouting(!routing)}
        >
          {routing ? '完成规划' : route.length ? '继续添加途经点' : '开始规划'}
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
      <p className={styles.empty}>奔跑时间按 5 m/s 估算，只算水平距离。</p>
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
    <section className={styles.picked} aria-label="当前选中">
      <div className={styles.pickedHead}>
        <SandIcon icon={selected[5]} kind={selected[0]} size={48} />
        <div>
          <b>{selected[3]}</b>
          <small>{SAND_KINDS[selected[0]].label}</small>
        </div>
        <button type="button" aria-label="取消选中" onClick={onClear}>
          ×
        </button>
      </div>
      {selected[4] ? (
        <ul className={styles.chips}>
          {selected[4].split(' · ').map(condition => (
            <li key={condition}>{condition}</li>
          ))}
        </ul>
      ) : null}
      {selected[7]?.length ? (
        <p className={styles.link}>沙盘上的连线指向开启它的位置，先到那里操作。</p>
      ) : null}
      {nearest.length ? (
        <div className={styles.group}>
          <h3>最近的撤离点</h3>
          {nearest.map(({ point, distance }, index) => (
            <div key={index} className={styles.nearest}>
              <PointRow
                point={point}
                active={false}
                detail={`${Math.round(distance)} 米 · ${point[4]}`}
                onPoint={onPoint}
              />
              <button
                type="button"
                onClick={() =>
                  onRoute([
                    [selected[1], selected[2]],
                    [point[1], point[2]],
                  ])
                }
              >
                画路线
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}

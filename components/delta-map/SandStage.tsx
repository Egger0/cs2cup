import type { CSSProperties, MouseEvent, RefObject } from 'react'
import {
  SAND_KINDS,
  floorImageUrl,
  mapImageUrl,
  type DeltaMapData,
  type SandKind,
  type SandPoint,
} from '@/lib/delta-sand'
import type { SandRuntime } from './runtime'
import type { Waypoint } from './SandTable'
import styles from './SandTable.module.css'

export type SandMode = 'loading' | 'solid' | 'flat'

const spot = (x: number, y: number, extra?: CSSProperties) =>
  ({ '--fx': x, '--fy': y, ...extra }) as CSSProperties

export function SandStage({
  host,
  overlay,
  data,
  mapId,
  mode,
  level,
  kinds,
  pinned,
  building,
  floor,
  routing,
  route,
  runtime,
  onPoint,
  onFloor,
  onGround,
  onOverview,
}: {
  host: RefObject<HTMLDivElement | null>
  overlay: RefObject<HTMLDivElement | null>
  data: DeltaMapData | null
  mapId: string
  mode: SandMode
  level: number
  kinds: ReadonlySet<SandKind>
  pinned: SandPoint | null
  building: number | null
  floor: string | null
  routing: boolean
  route: Waypoint[]
  runtime: RefObject<SandRuntime | null>
  onPoint: (point: SandPoint) => void
  onFloor: (code: string) => void
  onGround: (x: number, y: number) => void
  onOverview: () => void
}) {
  const flat = mode === 'flat'
  const inside = building === null ? null : (data?.buildings[building] ?? null)
  const points = (data?.levels[level]?.points ?? []).filter(point =>
    inside ? point[5] === `${building}:${floor}` : !point[5],
  )
  const tap = (event: MouseEvent<HTMLDivElement>) => {
    if (!flat || !routing || event.target !== event.currentTarget) return
    const rect = event.currentTarget.getBoundingClientRect()
    const side = Math.min(rect.width, rect.height)
    const x = (event.clientX - rect.left - (rect.width - side) / 2) / side
    const y = (event.clientY - rect.top - (rect.height - side) / 2) / side
    if (x >= 0 && y >= 0 && x <= 1 && y <= 1) onGround(x, y)
  }
  return (
    <div ref={host} className={styles.viewport} data-sand-stage>
      <img className={styles.poster} src={mapImageUrl(mapId, 1024)} alt="" />
      {flat && inside && floor && inside.frames[inside.floors.indexOf(floor)] ? (
        <img
          className={styles.floorPlan}
          src={floorImageUrl(mapId, building!, floor)}
          alt=""
          style={spot(
            inside.frames[inside.floors.indexOf(floor)]![0],
            inside.frames[inside.floors.indexOf(floor)]![1],
            {
              '--fs': inside.frames[inside.floors.indexOf(floor)]![2],
            } as CSSProperties,
          )}
        />
      ) : null}
      {flat && route.length ? (
        <svg className={styles.routeLine} viewBox="0 0 1 1" aria-hidden="true">
          <polyline points={route.map(([x, y]) => `${x},${y}`).join(' ')} />
        </svg>
      ) : null}
      <div ref={overlay} className={styles.overlay} onClick={tap}>
        {flat
          ? points
              .filter(point => kinds.has(point[0]))
              .map((point, index) => (
                <button
                  key={index}
                  type="button"
                  className={styles.dot}
                  aria-label={`${SAND_KINDS[point[0]].label} ${point[3]}`}
                  style={spot(point[1], point[2], {
                    '--tone': SAND_KINDS[point[0]].color,
                  } as CSSProperties)}
                  onClick={() => onPoint(point)}
                />
              ))
          : null}
        {inside
          ? inside.floors.map(code => (
              <button
                key={code}
                type="button"
                className={styles.floorTag}
                aria-pressed={code === floor}
                data-sand-anchor
                data-floor={`${building}:${code}`}
                data-label
                data-priority="1"
                style={spot(inside.x, inside.y)}
                onClick={() => onFloor(code)}
              >
                {code}
              </button>
            ))
          : (data?.regions ?? []).map(([name, x, y]) => (
              <button
                key={name}
                type="button"
                className={styles.region}
                data-sand-anchor
                data-x={x}
                data-y={y}
                style={spot(x, y)}
                onClick={() => runtime.current?.focus(x, y)}
              >
                {name}
              </button>
            ))}
        {pinned ? (
          <div
            className={styles.pin}
            data-sand-anchor
            data-priority="2"
            data-x={pinned[1]}
            data-y={pinned[2]}
            data-floor={pinned[5] || undefined}
            data-rise={SAND_KINDS[pinned[0]].rise + 0.03}
            style={spot(pinned[1], pinned[2], {
              '--tone': SAND_KINDS[pinned[0]].color,
            } as CSSProperties)}
          >
            <small>{SAND_KINDS[pinned[0]].label}</small>
            <b>{pinned[3]}</b>
            {pinned[4] ? <span>{pinned[4]}</span> : null}
          </div>
        ) : null}
      </div>
      {mode === 'solid' ? (
        <div className={styles.controls}>
          <button type="button" aria-label="放大" onClick={() => runtime.current?.zoom(0.8)}>
            +
          </button>
          <button type="button" aria-label="缩小" onClick={() => runtime.current?.zoom(1.25)}>
            −
          </button>
          <button type="button" onClick={onOverview}>
            全图
          </button>
        </div>
      ) : null}
      <p className={styles.hint} aria-live="polite">
        {routing
          ? '规划路线中 · 点沙盘添加途经点'
          : mode === 'solid'
            ? '拖动旋转 · 点区域名飞过去 · 点一下沙盘后滚轮缩放'
            : mode === 'flat'
              ? '俯视图 · 这台设备没有开启 3D'
              : '沙盘展开中…'}
      </p>
    </div>
  )
}

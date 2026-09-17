import type { CSSProperties, MouseEvent, ReactNode, RefObject } from 'react'
import {
  SAND_KINDS,
  floorImageUrl,
  mapImageUrl,
  type DeltaMapData,
  type SandKind,
  type SandPoint,
} from '@/lib/delta-sand'
import type { SandRuntime } from './runtime'
import { SandIcon } from './SandIcon'
import type { Waypoint } from './SandTable'
import styles from './SandTable.module.css'
import hud from './SandHud.module.css'

export type SandMode = 'loading' | 'solid' | 'flat'

const spot = (x: number, y: number, extra?: object) =>
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
  children,
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
  children: ReactNode
  onPoint: (point: SandPoint) => void
  onFloor: (code: string) => void
  onGround: (x: number, y: number) => void
  onOverview: () => void
}) {
  const flat = mode === 'flat'
  const inside = building === null ? null : (data?.buildings[building] ?? null)
  const frame = inside && floor ? inside.frames[inside.floors.indexOf(floor)] : undefined
  const points = (data?.levels[level]?.points ?? []).filter(point =>
    inside ? point[6] === `${building}:${floor}` : !point[6],
  )
  const tap = (event: MouseEvent<HTMLDivElement>) => {
    if (!flat || !routing || event.target !== event.currentTarget) return
    const rect = event.currentTarget.getBoundingClientRect()
    const side = Math.min(rect.width, rect.height)
    const x = (event.clientX - rect.left - (rect.width - side) / 2) / side
    const y = (event.clientY - rect.top - (rect.height - side) / 2) / side
    if (x >= 0 && y >= 0 && x <= 1 && y <= 1) onGround(x, y)
  }
  const conditions = pinned?.[4].split(' · ') ?? []
  return (
    <div ref={host} className={styles.viewport} data-sand-stage>
      <img className={styles.poster} src={mapImageUrl(mapId, 1024)} alt="" />
      {flat && frame ? (
        <img
          className={styles.floorPlan}
          src={floorImageUrl(mapId, building!, floor!)}
          alt=""
          style={spot(frame[0], frame[1], { '--fs': frame[2] })}
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
                  style={spot(point[1], point[2])}
                  onClick={() => onPoint(point)}
                >
                  <SandIcon icon={point[5]} kind={point[0]} size={22} />
                </button>
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
            data-floor={pinned[6] || undefined}
            data-rise={SAND_KINDS[pinned[0]].rise * 0.55 + 0.02}
            style={spot(pinned[1], pinned[2], { '--tone': SAND_KINDS[pinned[0]].color })}
          >
            <SandIcon icon={pinned[5]} kind={pinned[0]} size={40} />
            <div>
              <b>{pinned[3]}</b>
              <small>{SAND_KINDS[pinned[0]].label}</small>
              {conditions.length ? (
                <ul>
                  {conditions.map(condition => (
                    <li key={condition}>{condition}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      {children}
      {mode === 'solid' ? (
        <div className={hud.controls}>
          <button
            type="button"
            className={hud.compass}
            aria-label="朝向正北"
            title="朝向正北"
            onClick={() => runtime.current?.north()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3 16 12h-8z" />
              <path d="M12 21 8 12h8z" />
            </svg>
          </button>
          <button type="button" aria-label="放大" onClick={() => runtime.current?.zoom(0.8)}>
            +
          </button>
          <button type="button" aria-label="缩小" onClick={() => runtime.current?.zoom(1.25)}>
            −
          </button>
          <button type="button" aria-label="回到全图" title="回到全图" onClick={onOverview}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
            </svg>
          </button>
        </div>
      ) : null}
      <p className={hud.hint} aria-live="polite">
        {routing
          ? '点沙盘添加途经点'
          : mode === 'flat'
            ? '俯视图模式：这台设备没有开启 3D'
            : mode === 'loading'
              ? '沙盘展开中'
              : null}
      </p>
    </div>
  )
}

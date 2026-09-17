import Link from 'next/link'
import type { CSSProperties } from 'react'
import {
  SAND_KINDS,
  type DeltaMapData,
  type DeltaMapSummary,
  type SandKind,
  type SandPoint,
} from '@/lib/delta-sand'
import { SandSearch } from './SandSearch'
import { SandFloors, SandPicked, SandRoute } from './SandPlanner'
import type { Waypoint } from './SandTable'
import styles from './SandPanel.module.css'

export function SandPanel({
  map,
  data,
  level,
  kinds,
  selected,
  building,
  floor,
  routing,
  route,
  loadouts,
  onLevel,
  onKinds,
  onPoint,
  onRegion,
  onBuilding,
  onRouting,
  onRoute,
  onClear,
}: {
  map: DeltaMapSummary
  data: DeltaMapData | null
  level: number
  kinds: ReadonlySet<SandKind>
  selected: SandPoint | null
  building: number | null
  floor: string | null
  routing: boolean
  route: Waypoint[]
  loadouts: string
  onLevel: (level: number) => void
  onKinds: (kinds: ReadonlySet<SandKind>) => void
  onPoint: (point: SandPoint) => void
  onRegion: (x: number, y: number) => void
  onBuilding: (index: number | null, floor: string | null) => void
  onRouting: (routing: boolean) => void
  onRoute: (route: Waypoint[]) => void
  onClear: () => void
}) {
  const points = data?.levels[level]?.points ?? []
  const exits = points.filter(point => point[0] === 'exit')
  const toggle = (kind: SandKind) => {
    const next = new Set(kinds)
    if (!next.delete(kind)) next.add(kind)
    onKinds(next)
  }
  return (
    <aside className={styles.panel} aria-label={`${map.name} 情报`}>
      <header className={styles.heading}>
        <span className={styles.code}>{map.en}</span>
        <h2>{map.name}</h2>
        <p>
          约 {(map.meters / 1000).toFixed(1)} km 见方 · 高差 {map.relief} m ·{' '}
          {map.areas.split(' · ').length} 个区域
        </p>
      </header>

      <div className={styles.group}>
        <h3>难度</h3>
        <div className={styles.chips}>
          {map.levels.map((entry, index) => (
            <button
              key={entry}
              type="button"
              aria-pressed={index === level}
              onClick={() => onLevel(index)}
            >
              {entry.replace('|', '｜')}
            </button>
          ))}
        </div>
      </div>

      <SandSearch data={data} points={points} onPoint={onPoint} onRegion={onRegion} />

      {data?.buildings.length ? (
        <SandFloors
          data={data}
          points={points}
          building={building}
          floor={floor}
          onBuilding={onBuilding}
        />
      ) : null}

      <SandRoute
        meters={map.meters}
        routing={routing}
        route={route}
        onRouting={onRouting}
        onRoute={onRoute}
      />

      {selected ? (
        <SandPicked
          selected={selected}
          points={points}
          meters={map.meters}
          onPoint={onPoint}
          onRoute={next => {
            onRoute(next)
            onRouting(true)
          }}
          onClear={onClear}
        />
      ) : null}

      <div className={styles.group}>
        <h3>图层</h3>
        <div className={styles.layers}>
          {(Object.keys(SAND_KINDS) as SandKind[]).map(kind => {
            const count = points.filter(point => point[0] === kind).length
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={kinds.has(kind)}
                disabled={Boolean(data) && !count}
                style={{ '--tone': SAND_KINDS[kind].color } as CSSProperties}
                onClick={() => toggle(kind)}
              >
                <i aria-hidden="true" />
                {SAND_KINDS[kind].label}
                <small>{data ? count : '—'}</small>
              </button>
            )
          })}
        </div>
      </div>

      <div className={styles.group}>
        <h3>撤离点 · {exits.length}</h3>
        <ol className={styles.exits}>
          {exits.map((point, index) => (
            <li key={index}>
              <button
                type="button"
                aria-pressed={selected === point}
                onClick={() => onPoint(point)}
              >
                <span>{point[3]}</span>
                {point[4] ? <small>{point[4]}</small> : null}
              </button>
            </li>
          ))}
        </ol>
      </div>

      <Link className={styles.loadouts} href={`${loadouts}?map=${encodeURIComponent(map.name)}`}>
        {map.name}能用的改枪码 <span aria-hidden="true">→</span>
      </Link>
      <p className={styles.credit}>
        底图、楼层图与点位来自《三角洲行动》官方地图工具，版权归腾讯；地形起伏由点位高程推算并做了夸张。
      </p>
    </aside>
  )
}

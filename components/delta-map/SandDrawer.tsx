import Link from 'next/link'
import type { DeltaMapData, DeltaMapSummary, SandPoint } from '@/lib/delta-sand'
import { SandIcon } from './SandIcon'
import { SandFloors, SandPicked, SandRoute } from './SandPlanner'
import { SandSearch } from './SandSearch'
import type { Waypoint } from './SandTable'
import styles from './SandDrawer.module.css'

export type SandTab = 'intel' | 'search' | 'floors' | 'route'

const TABS: [SandTab, string][] = [
  ['intel', '情报'],
  ['search', '搜索'],
  ['floors', '楼层'],
  ['route', '路线'],
]

export function SandDrawer({
  map,
  data,
  level,
  tab,
  selected,
  building,
  floor,
  routing,
  route,
  loadouts,
  onTab,
  onLevel,
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
  tab: SandTab
  selected: SandPoint | null
  building: number | null
  floor: string | null
  routing: boolean
  route: Waypoint[]
  loadouts: string
  onTab: (tab: SandTab) => void
  onLevel: (level: number) => void
  onPoint: (point: SandPoint) => void
  onRegion: (x: number, y: number) => void
  onBuilding: (index: number | null, floor: string | null) => void
  onRouting: (routing: boolean) => void
  onRoute: (route: Waypoint[]) => void
  onClear: () => void
}) {
  const points = data?.levels[level]?.points ?? []
  const exits = points.filter(point => point[0] === 'exit' && !point[6])
  const tabs = TABS.filter(([key]) => key !== 'floors' || data?.buildings.length)
  return (
    <aside className={styles.drawer} aria-label={`${map.name}情报`}>
      <header className={styles.head}>
        <h2>{map.name}</h2>
        <p>
          {(map.meters / 1000).toFixed(1)} km 见方，高差 {map.relief} m
        </p>
        <div className={styles.levels} role="group" aria-label="难度">
          {map.levels.map((entry, index) => (
            <button
              key={entry}
              type="button"
              aria-pressed={index === level}
              onClick={() => onLevel(index)}
            >
              {entry.replace(/[|｜]/, ' · ')}
            </button>
          ))}
        </div>
      </header>

      {selected ? (
        <SandPicked
          selected={selected}
          points={points}
          meters={map.meters}
          onPoint={onPoint}
          onRoute={next => {
            onRoute(next)
            onRouting(true)
            onTab('route')
          }}
          onClear={onClear}
        />
      ) : null}

      <div className={styles.tabs} role="tablist" aria-label="沙盘工具">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`sand-tab-${key}`}
            aria-selected={tab === key}
            aria-controls="sand-panel"
            onClick={() => onTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        className={styles.body}
        id="sand-panel"
        role="tabpanel"
        aria-labelledby={`sand-tab-${tab}`}
      >
        {tab === 'intel' ? (
          <>
            {map.bosses ? (
              <p className={styles.boss}>
                <span>首领</span>
                {map.bosses}
              </p>
            ) : null}
            <h3 className={styles.caption}>撤离点</h3>
            <ul className={styles.exits}>
              {exits.map((point, index) => (
                <li key={index}>
                  <button
                    type="button"
                    aria-pressed={selected === point}
                    onClick={() => onPoint(point)}
                  >
                    <SandIcon icon={point[5]} kind="exit" size={30} />
                    <span>
                      <b>{point[3]}</b>
                      <small>{point[4]}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Link
              className={styles.loadouts}
              href={`${loadouts}?map=${encodeURIComponent(map.name)}`}
            >
              看看{map.name}的改枪码
            </Link>
            <p className={styles.credit}>
              底图、楼层图、图标与点位来自《三角洲行动》官方地图工具，版权归腾讯。地形起伏由点位高程推算。
            </p>
          </>
        ) : null}
        {tab === 'search' ? (
          <SandSearch data={data} points={points} onPoint={onPoint} onRegion={onRegion} />
        ) : null}
        {tab === 'floors' && data ? (
          <SandFloors
            data={data}
            points={points}
            building={building}
            floor={floor}
            selected={selected}
            onBuilding={onBuilding}
            onPoint={onPoint}
          />
        ) : null}
        {tab === 'route' ? (
          <SandRoute
            meters={map.meters}
            routing={routing}
            route={route}
            onRouting={onRouting}
            onRoute={onRoute}
          />
        ) : null}
      </div>
    </aside>
  )
}

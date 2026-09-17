'use client'

import { useDeferredValue, useState, type CSSProperties } from 'react'
import { SAND_KINDS, type DeltaMapData, type SandPoint } from '@/lib/delta-sand'
import styles from './SandTools.module.css'

export function SandSearch({
  data,
  points,
  onPoint,
  onRegion,
}: {
  data: DeltaMapData | null
  points: SandPoint[]
  onPoint: (point: SandPoint) => void
  onRegion: (x: number, y: number) => void
}) {
  const [query, setQuery] = useState('')
  const term = useDeferredValue(query.trim())
  const regions = term ? (data?.regions ?? []).filter(([name]) => name.includes(term)) : []
  const floorName = (point: SandPoint) => {
    const [owner, code] = (point[6] ?? '').split(':')
    return code ? `${data?.buildings[Number(owner)]?.name ?? ''} ${code}` : ''
  }
  const hits = term
    ? points
        .filter(point => `${point[3]} ${point[4]} ${floorName(point)}`.includes(term))
        .slice(0, 30)
    : []
  return (
    <div className={styles.search}>
      <label>
        <span>搜点位</span>
        <input
          type="search"
          value={query}
          placeholder="变电站宿舍、服务器、拉闸…"
          onChange={event => setQuery(event.target.value)}
        />
      </label>
      {term ? (
        <ul className={styles.results} aria-live="polite">
          {regions.map(([name, x, y]) => (
            <li key={`region-${name}`}>
              <button type="button" onClick={() => onRegion(x, y)}>
                <span>{name}</span>
                <small>区域</small>
              </button>
            </li>
          ))}
          {hits.map((point, index) => (
            <li key={index}>
              <button
                type="button"
                style={{ '--tone': SAND_KINDS[point[0]].color } as CSSProperties}
                onClick={() => onPoint(point)}
              >
                <span>
                  <i aria-hidden="true" />
                  {point[3]}
                </span>
                <small>{[floorName(point), point[4]].filter(Boolean).join(' · ')}</small>
              </button>
            </li>
          ))}
          {!regions.length && !hits.length ? (
            <li className={styles.none}>这个难度没有匹配的点位</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}

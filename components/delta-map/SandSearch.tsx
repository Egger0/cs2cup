'use client'

import { useDeferredValue, useState } from 'react'
import type { DeltaMapData, SandPoint } from '@/lib/delta-sand'
import { PointRow } from './SandPlanner'
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
  const floorName = (point: SandPoint) => {
    const [owner, code] = (point[6] ?? '').split(':')
    return code ? `${data?.buildings[Number(owner)]?.name ?? ''} ${code}` : ''
  }
  const regions = term ? (data?.regions ?? []).filter(([name]) => name.includes(term)) : []
  const hits = term
    ? points
        .filter(point => `${point[3]} ${point[4]} ${floorName(point)}`.includes(term))
        .slice(0, 40)
    : []
  return (
    <div className={styles.stack}>
      <input
        className={styles.search}
        type="search"
        value={query}
        aria-label="搜索点位、房间或区域"
        placeholder="搜点位、房间或区域，比如 变电站宿舍"
        onChange={event => setQuery(event.target.value)}
      />
      {term ? (
        <div aria-live="polite">
          {regions.map(([name, x, y]) => (
            <button
              key={name}
              type="button"
              className={styles.region}
              onClick={() => onRegion(x, y)}
            >
              <b>{name}</b>
              <small>飞到这个区域</small>
            </button>
          ))}
          {hits.map((point, index) => (
            <PointRow
              key={index}
              point={point}
              active={false}
              detail={[floorName(point), point[4]].filter(Boolean).join(' · ')}
              onPoint={onPoint}
            />
          ))}
          {!regions.length && !hits.length ? (
            <p className={styles.empty}>这个难度下没有匹配「{term}」的点位。</p>
          ) : null}
        </div>
      ) : (
        <p className={styles.empty}>
          可以搜物资名、房间名、撤离条件（比如「丢弃背包」「钥匙卡」）或楼层。
        </p>
      )}
    </div>
  )
}

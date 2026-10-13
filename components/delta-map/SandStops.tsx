import type { CSSProperties } from 'react'
import type { Waypoint } from '@/lib/sand-routes'
import styles from './SandRoutes.module.css'

export function SandStops({
  route,
  stop,
  onStop,
}: {
  route: Waypoint[]
  stop: number | null
  onStop: (index: number) => void
}) {
  return route.map(([x, y, note], index) => (
    <button
      key={index}
      type="button"
      className={styles.stop}
      data-sand-anchor
      data-priority={index === stop ? 2 : 1}
      data-x={x}
      data-y={y}
      aria-pressed={index === stop}
      aria-label={`第 ${index + 1} 站${note ? `：${note}` : ''}`}
      style={{ '--fx': x, '--fy': y } as CSSProperties}
      onClick={() => onStop(index)}
    >
      {index === stop && note ? <span>{note}</span> : null}
      <b>{index + 1}</b>
    </button>
  ))
}

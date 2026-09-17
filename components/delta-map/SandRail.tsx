import { mapImageUrl, type DeltaMapSummary } from '@/lib/delta-sand'
import styles from './SandHud.module.css'

export function SandRail({
  maps,
  current,
  onChoose,
}: {
  maps: DeltaMapSummary[]
  current: string
  onChoose: (id: string) => void
}) {
  return (
    <nav className={styles.rail} aria-label="烽火地带地图">
      {maps.map(map => (
        <button
          key={map.id}
          type="button"
          aria-pressed={map.id === current}
          onClick={() => onChoose(map.id)}
        >
          <img src={mapImageUrl(map.id, 256)} alt="" width={40} height={40} loading="lazy" />
          <span>{map.name}</span>
        </button>
      ))}
    </nav>
  )
}

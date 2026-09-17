import { SAND_KINDS, type SandKind, type SandPoint } from '@/lib/delta-sand'
import { SandIcon } from './SandIcon'
import styles from './SandHud.module.css'

const ORDER = Object.keys(SAND_KINDS) as SandKind[]

export function SandLayers({
  points,
  kinds,
  onKinds,
}: {
  points: SandPoint[]
  kinds: ReadonlySet<SandKind>
  onKinds: (kinds: ReadonlySet<SandKind>) => void
}) {
  return (
    <div className={styles.layers} role="group" aria-label="图层">
      {ORDER.map(kind => {
        const own = points.filter(point => point[0] === kind)
        const sample = own.find(point => point[5] >= 0)
        return (
          <button
            key={kind}
            type="button"
            aria-pressed={kinds.has(kind)}
            disabled={!own.length}
            title={SAND_KINDS[kind].label}
            onClick={() => {
              const next = new Set(kinds)
              if (!next.delete(kind)) next.add(kind)
              onKinds(next)
            }}
          >
            <SandIcon icon={sample?.[5] ?? -1} kind={kind} size={30} />
            <span className={styles.tip}>{SAND_KINDS[kind].label}</span>
            <small>{own.length}</small>
          </button>
        )
      })}
    </div>
  )
}

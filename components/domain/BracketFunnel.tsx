import type { PublicTeam } from '@/lib/types'
import styles from './BracketFunnel.module.css'

export interface BracketFunnelProps {
  teams: PublicTeam[]
  capacity: number
}

const WIDTH = 940
const HEIGHT = 620
const PAD_Y = 26

function column(count: number, index: number, total: number) {
  const x = (WIDTH / (total - 1)) * index
  const usable = HEIGHT - PAD_Y * 2
  return Array.from({ length: count }, (_, i) => ({
    x,
    y: PAD_Y + (usable / count) * (i + 0.5),
  }))
}

export function BracketFunnel({ teams, capacity }: BracketFunnelProps) {
  const rounds: number[] = []
  for (let size = capacity; size >= 1; size = Math.floor(size / 2)) rounds.push(size)

  const columns = rounds.map((count, index) => column(count, index, rounds.length))
  const filled = new Set(teams.map((_, index) => index))

  const edges: { d: string; round: number; lit: boolean; key: string }[] = []

  for (let r = 0; r < columns.length - 1; r += 1) {
    const from = columns[r]
    const to = columns[r + 1]
    if (!from || !to) continue

    for (let i = 0; i < from.length; i += 1) {
      const a = from[i]
      const b = to[Math.floor(i / 2)]
      if (!a || !b) continue
      const mid = a.x + (b.x - a.x) * 0.58
      edges.push({
        key: `${r}-${i}`,
        round: r,
        lit: r === 0 && filled.has(i),
        d: `M ${a.x} ${a.y} H ${mid} V ${b.y} H ${b.x}`,
      })
    }
  }

  const entry = columns[0] ?? []
  const apex = columns.at(-1)?.[0]

  return (
    <svg
      className={styles.funnel}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`${capacity} 支战队的单败淘汰结构,已有 ${teams.length} 支报名`}
    >
      <defs>
        <linearGradient id="funnel-lit" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--ct)" stopOpacity="0.85" />
          <stop offset="100%" stopColor="var(--t)" stopOpacity="0.5" />
        </linearGradient>
      </defs>

      <g className={styles.edges}>
        {edges.map(edge => (
          <path
            key={edge.key}
            d={edge.d}
            className={edge.lit ? `${styles.edge} ${styles.lit}` : styles.edge}
            style={{ '--round': edge.round } as React.CSSProperties}
          />
        ))}
      </g>

      <g>
        {entry.map((node, index) => (
          <circle
            key={index}
            cx={node.x}
            cy={node.y}
            r={filled.has(index) ? 4 : 2.5}
            className={filled.has(index) ? `${styles.node} ${styles.nodeLit}` : styles.node}
            style={{ '--i': index } as React.CSSProperties}
          />
        ))}
      </g>

      {apex ? (
        <g className={styles.apex}>
          <circle cx={apex.x} cy={apex.y} r="7" className={styles.apexCore} />
          <circle cx={apex.x} cy={apex.y} r="15" className={styles.apexRing} />
        </g>
      ) : null}
    </svg>
  )
}

import styles from './BracketGhost.module.css'

const COLUMN = 120
const SLOT = 80
const ROW = 40

export function BracketGhost({ cap }: { cap: number }) {
  const rounds = Math.max(2, Math.min(5, Math.round(Math.log2(Math.max(2, cap)))))
  const first = 2 ** (rounds - 1)
  const height = first * ROW
  const width = rounds * COLUMN - (COLUMN - SLOT)
  const centre = (round: number, index: number) =>
    (height / 2 ** (rounds - 1 - round)) * (index + 0.5)

  return (
    <svg
      className={styles.ghost}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {Array.from({ length: rounds }, (_, round) =>
        Array.from({ length: 2 ** (rounds - 1 - round) }, (_, index) => {
          const x = round * COLUMN
          const y = centre(round, index)
          const parent = round + 1 < rounds ? centre(round + 1, Math.floor(index / 2)) : null
          return (
            <g key={`${round}-${index}`}>
              <rect x={x} y={y - 13} width={SLOT} height={26} rx="2" />
              {parent === null ? null : (
                <polyline
                  points={`${x + SLOT},${y} ${x + SLOT + 20},${y} ${x + SLOT + 20},${parent} ${x + COLUMN},${parent}`}
                />
              )}
            </g>
          )
        }),
      )}
    </svg>
  )
}

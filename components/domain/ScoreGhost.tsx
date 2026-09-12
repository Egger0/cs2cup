const ROWS = 5
const ROW = 56
const NAME = 210
const CELL = 30
const WIDTH = 560

export function ScoreGhost() {
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${ROWS * ROW}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {Array.from({ length: ROWS }, (_, row) => {
        const middle = row * ROW + ROW / 2
        return (
          <g key={row}>
            <rect x="0" y={middle - 11} width={NAME} height="22" rx="2" />
            <rect x={NAME + 20} y={middle - 11} width={CELL} height="22" rx="2" />
            <rect x={NAME + 20 + CELL + 10} y={middle - 11} width={CELL} height="22" rx="2" />
            <rect x={WIDTH - NAME} y={middle - 11} width={NAME} height="22" rx="2" />
            {row === ROWS - 1 ? null : (
              <line x1="0" y1={(row + 1) * ROW} x2={WIDTH} y2={(row + 1) * ROW} />
            )}
          </g>
        )
      })}
    </svg>
  )
}

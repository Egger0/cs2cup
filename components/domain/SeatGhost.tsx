const COLUMNS = 4
const SLOT = 120
const ROW = 64
const GAP = 16

export function SeatGhost({ cap }: { cap: number }) {
  const seats = Math.max(2, Math.min(32, cap))
  const rows = Math.ceil(seats / COLUMNS)
  const width = COLUMNS * (SLOT + GAP) - GAP
  const height = rows * (ROW + GAP) - GAP

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {Array.from({ length: seats }, (_, seat) => (
        <rect
          key={seat}
          x={(seat % COLUMNS) * (SLOT + GAP)}
          y={Math.floor(seat / COLUMNS) * (ROW + GAP)}
          width={SLOT}
          height={ROW}
          rx="2"
        />
      ))}
    </svg>
  )
}

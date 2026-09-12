const CARDS = 3
const CARD = 300
const GAP = 24
const LINES = [90, 210, 250, 180]

export function RuleGhost() {
  const width = CARDS * (CARD + GAP) - GAP

  return (
    <svg viewBox={`0 0 ${width} 200`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {Array.from({ length: CARDS }, (_, card) => {
        const x = card * (CARD + GAP)
        return (
          <g key={card}>
            <rect x={x} y="0" width={CARD} height="200" rx="2" />
            {LINES.map((line, index) => (
              <rect
                key={line}
                x={x + 26}
                y={38 + index * 34}
                width={line}
                height={index === 0 ? 10 : 14}
                rx="2"
              />
            ))}
          </g>
        )
      })}
    </svg>
  )
}

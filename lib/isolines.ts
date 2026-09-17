export type Segment = [[number, number], [number, number]]

const EDGES = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
] as const

export function isolines(values: ArrayLike<number>, size: number, level: number) {
  const segments: Segment[] = []
  for (let row = 0; row < size - 1; row++)
    for (let col = 0; col < size - 1; col++) {
      const corners = [
        [col, row],
        [col + 1, row],
        [col + 1, row + 1],
        [col, row + 1],
      ] as const
      const heights = corners.map(([x, y]) => values[y * size + x]!)
      const hits: [number, number][] = []
      for (const [a, b] of EDGES) {
        if (heights[a]! > level === heights[b]! > level) continue
        const t = (level - heights[a]!) / (heights[b]! - heights[a]!)
        hits.push([
          corners[a][0] + (corners[b][0] - corners[a][0]) * t,
          corners[a][1] + (corners[b][1] - corners[a][1]) * t,
        ])
      }
      for (let i = 0; i + 1 < hits.length; i += 2) segments.push([hits[i]!, hits[i + 1]!])
    }
  return segments
}

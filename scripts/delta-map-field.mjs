export const GRID = 128

const KINDS = [
  ['exit', o => o.type === 'retreat'],
  ['boss', o => o.icon === 'boss'],
  ['spawn', o => o.icon === 'csd'],
  ['key', o => ['tyfk', 'mmf'].includes(o.icon)],
  ['vault', o => ['bxx', 'xbxx', 'fwq', 'hkcwx', 'gjcwx'].includes(o.icon)],
]

export const kindOf = item => KINDS.find(([, test]) => test(item))?.[0] ?? null

export function projector(info, turn = 0) {
  const across = x => (Number(x) - info.centerX) / info.width / 2
  const down = y => (Number(y) + info.centerY) / info.height / 2
  if (turn === 90) return item => [0.5 - down(item.y), 0.5 + across(item.x)]
  if (turn === -90) return item => [0.5 + down(item.y), 0.5 - across(item.x)]
  return item => [0.5 + across(item.x), 0.5 + down(item.y)]
}

const elevation = item => Number(item['z坐标'] ?? item.z) / 100

export function samples(items, project) {
  const seen = new Set()
  const out = []
  for (const item of items) {
    if (item.catalog === 'fish') continue
    const z = elevation(item)
    if (!Number.isFinite(z) || z === 0) continue
    const [u, v] = project(item)
    const key = `${u.toFixed(4)}:${v.toFixed(4)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ u, v, z, indoor: Boolean(item.floor), kind: kindOf(item) })
  }
  return out
}

const quantile = (sorted, q) => sorted[Math.floor(q * (sorted.length - 1))]

export function buildField(points, meters, anchors = []) {
  if (points.length < 12) throw new Error(`Too few elevation samples: ${points.length}`)
  const margin = 150 / meters
  const range = values => {
    const sorted = values.sort((a, b) => a - b)
    return [quantile(sorted, 0.002), quantile(sorted, 0.998)]
  }
  const [left, right] = range(points.map(point => point.u))
  const [top, bottom] = range(points.map(point => point.v))
  const side = Math.max(right - left, bottom - top) + margin * 2
  const origin = [(left + right) / 2 - side / 2, (top + bottom) / 2 - side / 2]
  const zs = points.map(point => point.z).sort((a, b) => a - b)
  const low = quantile(zs, 0.03)
  const high = Math.max(low + 1, quantile(zs, 0.97))
  const gauss = sigma => 1 / (2 * (sigma / meters / side) ** 2)
  const spacing = quantile(
    points
      .map(point =>
        Math.min(
          ...points
            .filter(other => other !== point)
            .map(other => Math.hypot(other.u - point.u, other.v - point.v) * meters),
        ),
      )
      .sort((a, b) => a - b),
    0.75,
  )
  const [solid, smooth] = [gauss(Math.max(24, spacing * 1.6)), gauss(Math.max(40, spacing * 2.6))]
  const local = points.map(point => ({
    ...point,
    x: (point.u - origin[0]) / side,
    y: (point.v - origin[1]) / side,
    zc: Math.min(high, Math.max(low, point.z)),
  }))
  const pins = anchors
    .map(point => ({ x: (point.u - origin[0]) / side, y: (point.v - origin[1]) / side }))
    .filter(pin => pin.x > 0 && pin.y > 0 && pin.x < 1 && pin.y < 1)
  const height = new Uint8Array(GRID * GRID)
  const mask = new Uint8Array(GRID * GRID)
  for (let row = 0; row < GRID; row++)
    for (let col = 0; col < GRID; col++) {
      const x = col / (GRID - 1)
      const y = row / (GRID - 1)
      let mass = 0
      let weights = 0
      let sum = 0
      for (const point of local) {
        const d2 = (point.x - x) ** 2 + (point.y - y) ** 2
        mass += Math.exp(-d2 * solid)
        const weight = Math.exp(-d2 * smooth) * (point.indoor ? 0.2 : 1)
        weights += weight
        sum += weight * point.zc
      }
      for (const pin of pins) mass += 3 * Math.exp(-((pin.x - x) ** 2 + (pin.y - y) ** 2) * solid)
      const index = row * GRID + col
      mask[index] = Math.min(255, Math.round(mass * 230))
      if (weights < 1e-12) continue
      height[index] = Math.round(((sum / weights - low) / (high - low)) * 255)
    }
  const reach = Math.max(2, Math.round(80 / ((side * meters) / GRID)))
  const closed = blur(filter(filter(mask, reach, Math.max), reach, Math.min), 2)
  return {
    origin,
    side,
    meters: Math.round(side * meters),
    relief: Math.round(high - low),
    height,
    mask: closed,
    local: point => [(point[0] - origin[0]) / side, (point[1] - origin[1]) / side],
    at(x, y) {
      const col = Math.min(GRID - 1, Math.max(0, Math.round(x * (GRID - 1))))
      const row = Math.min(GRID - 1, Math.max(0, Math.round(y * (GRID - 1))))
      return height[row * GRID + col] / 255
    },
  }
}

function filter(values, radius, pick) {
  const out = new Uint8Array(values.length)
  for (let row = 0; row < GRID; row++)
    for (let col = 0; col < GRID; col++) {
      let value = values[row * GRID + col]
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue
          const y = row + dy
          const x = col + dx
          value = pick(value, x < 0 || y < 0 || x >= GRID || y >= GRID ? 0 : values[y * GRID + x])
        }
      out[row * GRID + col] = value
    }
  return out
}

function blur(values, radius) {
  const out = new Uint8Array(values.length)
  for (let row = 0; row < GRID; row++)
    for (let col = 0; col < GRID; col++) {
      let sum = 0
      let count = 0
      for (let y = Math.max(0, row - radius); y <= Math.min(GRID - 1, row + radius); y++)
        for (let x = Math.max(0, col - radius); x <= Math.min(GRID - 1, col + radius); x++) {
          sum += values[y * GRID + x]
          count++
        }
      out[row * GRID + col] = Math.round(sum / count)
    }
  return out
}

export function composeRelief({ height, mask }, water) {
  const inside = [...height].filter((_, index) => mask[index] >= 127).sort((a, b) => a - b)
  const middle = inside[Math.floor(inside.length / 2)] ?? 128
  const wet = blur(blur(water, 2), 1)
  const relief = height.map((value, index) => {
    const weight = Math.min(1, Math.max(0, (mask[index] - 60) / 100))
    const land = weight * value + (1 - weight) * middle
    return Math.round((0.12 + (0.88 * land) / 255) * (1 - wet[index] / 255) * 255)
  })
  return blur(relief, 1)
}

export type Waypoint = [x: number, y: number, note?: string]

export const ROUTE_STOPS = { min: 2, max: 40 }
export const ROUTE_NOTE_LIMIT = 120
export const ROUTE_TITLE_LIMIT = 40
export const ROUTE_PENDING_LIMIT = 5
export const RUN_METERS_PER_SECOND = 5

export interface SandPlan {
  id: number
  mapId: string
  level: number
  title: string
  author: string
  approved: boolean
  waypoints: Waypoint[]
}

const unit = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1

export function parseWaypoints(value: unknown): Waypoint[] | null {
  if (!Array.isArray(value) || value.length < ROUTE_STOPS.min || value.length > ROUTE_STOPS.max) {
    return null
  }
  const route: Waypoint[] = []
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length > 3) return null
    const [x, y, note = ''] = entry as unknown[]
    if (!unit(x) || !unit(y) || typeof note !== 'string') return null
    const text = note.replace(/\s+/g, ' ').trim()
    if (text.length > ROUTE_NOTE_LIMIT) return null
    const [px, py] = [Number(x.toFixed(4)), Number(y.toFixed(4))]
    route.push(text ? [px, py, text] : [px, py])
  }
  return route
}

export const routeMeters = (route: Waypoint[], meters: number) =>
  route.reduce(
    (sum, [x, y], index) =>
      index ? sum + Math.hypot(x - route[index - 1]![0], y - route[index - 1]![1]) * meters : 0,
    0,
  )

export const routeQuery = (route: Waypoint[]) =>
  route.map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).join(';')

export const parseRouteQuery = (value: string | null): Waypoint[] =>
  (value ?? '')
    .split(';')
    .map(pair => pair.split(',').map(Number))
    .filter((pair): pair is [number, number] => pair.length === 2 && pair.every(unit))
    .slice(0, ROUTE_STOPS.max)

import { useCallback, useEffect, useState } from 'react'
import { parseRouteQuery, routeQuery, type SandPlan, type Waypoint } from '@/lib/sand-routes'

export function useSandRoute(shared: SandPlan | null) {
  const [route, setRoute] = useState<Waypoint[]>(shared?.waypoints ?? [])
  const [routing, setRouting] = useState(false)
  const [stop, setStop] = useState<number | null>(shared ? 0 : null)
  const [plan, setPlan] = useState<number | null>(shared?.id ?? null)

  useEffect(() => {
    if (shared) return
    const saved = parseRouteQuery(new URLSearchParams(location.search).get('route'))
    queueMicrotask(() => setRoute(saved))
  }, [shared])

  useEffect(() => {
    const url = new URL(location.href)
    for (const [key, value] of [
      ['plan', plan ? String(plan) : ''],
      ['route', plan ? '' : routeQuery(route)],
    ] as const) {
      if (value) url.searchParams.set(key, value)
      else url.searchParams.delete(key)
    }
    history.replaceState(history.state, '', url)
  }, [route, plan])

  const edit = useCallback((next: Waypoint[] | ((previous: Waypoint[]) => Waypoint[])) => {
    setPlan(null)
    setRoute(next)
  }, [])
  const open = useCallback((entry: SandPlan) => {
    setRoute(entry.waypoints)
    setPlan(entry.id)
    setRouting(false)
    setStop(0)
  }, [])

  return { route, routing, stop, plan, setRouting, setStop, edit, open }
}

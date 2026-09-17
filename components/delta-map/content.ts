import * as T from 'three'
import type { DeltaMapData, SandKind, SandPoint } from '@/lib/delta-sand'
import { buildFloorStack, type FloorStack } from './floors'
import { buildMarkers, disposeTree, type Markers } from './markers'
import { buildPlate, type Plate } from './plate'
import { buildRoute } from './route'

export function createContent(world: T.Group, invalidate: () => void) {
  let data: DeltaMapData | null = null
  let plate: Plate | null = null
  let markers: Markers | null = null
  let stack: FloorStack | null = null
  let leaving: FloorStack[] = []
  let route: T.Group | null = null
  let level = 0
  let kinds: ReadonlySet<SandKind> = new Set()
  let building: number | null = null
  let floor: string | null = null
  let waypoints: [number, number][] = []
  let dark = false

  const points = (): SandPoint[] => data?.levels[level]?.points ?? []
  const drop = (object: T.Object3D | null) => {
    if (!object) return
    world.remove(object)
    disposeTree(object)
  }
  const tone = () => plate?.tone(building !== null, dark)
  const rebuildMarkers = () => {
    drop(markers?.group ?? null)
    markers = null
    if (!plate) return
    const surface = plate
    markers = buildMarkers(
      points().filter(point => !point[5]),
      (x, y, rise) => surface.world(x, y, rise),
    )
    markers.show(kinds)
    world.add(markers.group)
  }
  const rebuildStack = () => {
    if (stack) {
      stack.collapse()
      leaving.push(stack)
    }
    stack = null
    if (!data || !plate || building === null || !data.buildings[building]) return tone()
    stack = buildFloorStack(data, plate, building, points(), invalidate)
    stack.focus(floor, kinds)
    world.add(stack.group)
    tone()
  }
  const rebuildRoute = () => {
    drop(route)
    route = plate ? buildRoute(plate, waypoints) : null
    if (route) world.add(route)
  }

  return {
    get plate() {
      return plate
    },
    get stack() {
      return stack
    },
    setMap(next: DeltaMapData, map: T.Texture) {
      this.clear()
      data = next
      plate = buildPlate(next, map)
      world.add(plate.mesh)
      building = null
      floor = null
      rebuildMarkers()
      rebuildRoute()
      tone()
    },
    setLevel(next: number) {
      level = next
      rebuildMarkers()
      if (building !== null) {
        drop(stack?.group ?? null)
        stack?.dispose()
        stack = null
        rebuildStack()
      }
    },
    setKinds(next: ReadonlySet<SandKind>) {
      kinds = next
      markers?.show(next)
      stack?.focus(floor, next)
    },
    setBuilding(next: number | null, code: string | null) {
      const changed = next !== building
      building = next
      floor = code
      if (changed) rebuildStack()
      else stack?.focus(code, kinds)
    },
    setRoute(next: [number, number][]) {
      waypoints = next
      rebuildRoute()
    },
    setNight(on: boolean) {
      dark = on
      tone()
    },
    step(seconds: number, still: boolean, rise: number) {
      if (markers) markers.group.visible = rise > 0.55 && building === null
      let moving = stack?.step(seconds, still) ?? false
      leaving = leaving.filter(entry => {
        moving = entry.step(seconds, still) || moving
        if (!entry.gone()) return true
        drop(entry.group)
        entry.dispose()
        return false
      })
      return moving
    },
    heads() {
      return [...(markers?.group.visible ? markers.heads : []), ...(stack?.heads() ?? [])].filter(
        head => head.mesh.parent?.visible !== false,
      )
    },
    locate(element: HTMLElement) {
      if (!plate) return null
      const x = Number(element.dataset.x)
      const y = Number(element.dataset.y)
      const rise = Number(element.dataset.rise ?? 0.03)
      const [owner, code] = (element.dataset.floor ?? '').split(':')
      if (code) {
        if (!stack || Number(owner) !== building) return null
        return element.dataset.label ? stack.labelAt(code) : stack.anchor(code, x, y, rise)
      }
      return plate.world(x, y, rise)
    },
    clear() {
      for (const entry of leaving) entry.dispose()
      leaving = []
      stack?.dispose()
      stack = null
      plate?.dispose()
      for (const child of [...world.children]) drop(child)
      plate = null
      markers = null
      route = null
    },
  }
}

export type SandContent = ReturnType<typeof createContent>

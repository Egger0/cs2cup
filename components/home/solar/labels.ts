import * as T from 'three'
import type { SolarSystem } from './system'
import { shown, type FlightState } from './flight'

interface Box {
  x: number
  y: number
  width: number
  height: number
  key?: string
}
const SIDES = ['right', 'left', 'below', 'above']
const clear = (box: Box, boxes: Box[]) =>
  boxes.every(
    other =>
      box.x >= other.x + other.width + 10 ||
      other.x >= box.x + box.width + 10 ||
      box.y >= other.y + other.height + 10 ||
      other.y >= box.y + box.height + 10,
  )
const attribute = (anchor: HTMLElement, name: string, value: string) => {
  if (anchor.dataset[name] !== value) anchor.dataset[name] = value
}
const property = (anchor: HTMLElement, name: string, value: string) => {
  if (anchor.style.getPropertyValue(name) !== value) anchor.style.setProperty(name, value)
}

export function createLabels(anchors: HTMLElement[]) {
  const sizes = new Map(
    anchors.map(anchor => [anchor, { width: anchor.offsetWidth, height: anchor.offsetHeight }]),
  )
  const observer = new ResizeObserver(entries => {
    for (const entry of entries) {
      const box = entry.borderBoxSize[0]
      if (box)
        sizes.set(entry.target as HTMLElement, { width: box.inlineSize, height: box.blockSize })
    }
  })
  anchors.forEach(anchor => observer.observe(anchor))
  return {
    dispose: () => observer.disconnect(),
    place(
      width: number,
      height: number,
      system: SolarSystem,
      camera: T.PerspectiveCamera,
      state: FlightState,
    ) {
      const tan = Math.tan(T.MathUtils.degToRad(camera.fov / 2))
      const unit = (world: T.Vector3) =>
        height / (2 * tan * Math.max(0.001, camera.position.distanceTo(world)))
      const screen = (point: T.Vector3) => ({
        x: (point.x * 0.5 + 0.5) * width,
        y: (-point.y * 0.5 + 0.5) * height,
      })
      const blocked: Box[] = [
        ...document.querySelectorAll<HTMLElement>('[data-solar-reserve], [data-solar-panel]'),
      ]
        .filter(element => element.checkVisibility({ visibilityProperty: true }))
        .map(element => {
          const rect = element.getBoundingClientRect()
          return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
        })
      for (const body of system.bodies) {
        if (body.parent || !shown(body.root)) continue
        const world = body.root.getWorldPosition(new T.Vector3())
        const center = screen(world.clone().project(camera))
        const radius = body.radius * unit(world)
        blocked.push({
          x: center.x - radius,
          y: center.y - radius,
          width: radius * 2,
          height: radius * 2,
          key: body.key,
        })
      }
      const fits = (box: Box) =>
        box.x >= 16 &&
        box.y >= 76 &&
        box.x + box.width <= width - 16 &&
        box.y + box.height <= height - 16
      const placed: Box[] = []
      const hoveredFirst = [...anchors].sort(
        (a, b) =>
          Number(b.dataset.solarAnchor === state.hovered) -
          Number(a.dataset.solarAnchor === state.hovered),
      )
      for (const anchor of hoveredFirst) {
        const key = anchor.dataset.solarAnchor
        const body = system.bodies.find(item => item.key === key)
        if (!body) continue
        const hovered = state.hovered === key
        const world = body.root.getWorldPosition(new T.Vector3())
        const point = world.clone().project(camera)
        const center = screen(point)
        const radius = body.radius * unit(world)
        const parent = body.parent
        let occluded = false
        if (parent) {
          const parentWorld = parent.root.getWorldPosition(new T.Vector3())
          const parentPoint = parentWorld.clone().project(camera)
          const parentCenter = screen(parentPoint)
          occluded =
            point.z > parentPoint.z &&
            Math.hypot(center.x - parentCenter.x, center.y - parentCenter.y) <
              parent.radius * unit(parentWorld)
        }
        const eligible =
          point.z < 1 &&
          shown(body.root) &&
          !occluded &&
          (state.selected
            ? parent?.key === state.selected && (state.level === 0 || hovered)
            : !parent || hovered)
        const size = sizes.get(anchor) ?? { width: 0, height: 0 }
        const candidates: Box[] = [
          { x: center.x + radius + 28, y: center.y - size.height / 2, ...size },
          { x: center.x - radius - 28 - size.width, y: center.y - size.height / 2, ...size },
          { x: center.x - size.width / 2, y: center.y + radius + 26, ...size },
          { x: center.x - size.width / 2, y: center.y - radius - 26 - size.height, ...size },
        ]
        const others = blocked.filter(box => box.key !== key)
        const index = candidates.findIndex(
          box => fits(box) && clear(box, others) && clear(box, placed),
        )
        const visible = eligible && (index >= 0 || hovered)
        const box = candidates[Math.max(0, index)]!
        if (visible) placed.push(box)
        const depth = 1.7 - camera.position.distanceTo(world) / Math.max(1, state.base)
        property(anchor, '--sx', `${Math.round(box.x * 2) / 2}px`)
        property(anchor, '--sy', `${Math.round(box.y * 2) / 2}px`)
        property(anchor, '--depth', T.MathUtils.clamp(depth, 0.4, 1).toFixed(2))
        attribute(anchor, 'side', SIDES[Math.max(0, index)]!)
        attribute(anchor, 'visible', String(visible))
        attribute(anchor, 'hovered', String(hovered))
      }
    },
  }
}

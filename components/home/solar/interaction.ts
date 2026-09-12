import * as T from 'three'
import { surfaceFeedback } from './surface-feedback'
import { shown, type FlightState } from './flight'
import type { SolarSystem } from './system'

const INTERACTIVE =
  'a, button, input, textarea, select, label, summary, [role="button"], [contenteditable], header, footer, [data-solar-panel], [data-solar-reserve]'

export function bindInteraction(
  canvas: HTMLCanvasElement,
  camera: T.Camera,
  system: SolarSystem,
  state: FlightState,
  select: (key: string | null) => void,
  zoom: (level: number) => void,
  invalidate: () => void,
) {
  const raycaster = new T.Raycaster()
  const pointers = new Map<number, T.Vector2>()
  const down = new T.Vector2()
  let moved = 0
  let pinch = 0
  let wheelAt = 0
  let lastMove = 0
  const blocked = (event: Event) =>
    state.chapter === 'far' ||
    (event.target instanceof Element && Boolean(event.target.closest(INTERACTIVE)))
  const hit = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect()
    raycaster.setFromCamera(
      new T.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    )
    const intersections = raycaster.intersectObjects(
      system.bodies.map(body => body.root),
      true,
    )
    const object = intersections.find(
      item => item.object instanceof T.Mesh && shown(item.object),
    )?.object
    return [...system.bodies].reverse().find(body => {
      let parent: T.Object3D | null | undefined = object
      while (parent) {
        if (parent === body.root) return true
        parent = parent.parent
      }
      return false
    })
  }
  const move = (event: PointerEvent) => {
    if (state.chapter === 'far') return
    const rect = canvas.getBoundingClientRect()
    state.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      ((event.clientY - rect.top) / rect.height) * 2 - 1,
    )
    if (pointers.has(event.pointerId))
      pointers.set(event.pointerId, new T.Vector2(event.clientX, event.clientY))
    if (pointers.size === 2) {
      moved = 10
      const [a, b] = [...pointers.values()]
      const distance = a!.distanceTo(b!)
      if (pinch && Math.abs(distance - pinch) > 35) {
        zoom(T.MathUtils.clamp(state.level + (distance > pinch ? 1 : -1), 0, 2))
        pinch = distance
      }
      if (!pinch) pinch = distance
    } else if (state.dragging && state.selected) {
      const displacement = new T.Vector2(
        (event.clientX - down.x) * 0.005,
        (event.clientY - down.y) * 0.005,
      )
      state.velocity
        .copy(displacement)
        .divideScalar(Math.max(0.5, (event.timeStamp - lastMove) / 16.667))
        .clampLength(0, 0.075)
      state.spin.add(displacement)
      state.spin.y = T.MathUtils.clamp(state.spin.y, -1.1, 1.1)
      state.spin.x = T.MathUtils.clamp(state.spin.x, -3.1, 3.1)
      lastMove = event.timeStamp
      moved += Math.abs(event.clientX - down.x) + Math.abs(event.clientY - down.y)
      down.set(event.clientX, event.clientY)
    } else if (!state.dragging) {
      const body = blocked(event) ? undefined : hit(event)
      state.hovered = body?.key ?? null
      document.body.style.cursor = body ? 'pointer' : ''
    }
    const selected = system.bodies.find(body => body.key === state.selected)
    if (selected) {
      selected.model.userData.pointerX = state.pointer.x
      raycaster.setFromCamera(new T.Vector2(state.pointer.x, -state.pointer.y), camera)
      surfaceFeedback(selected.model, raycaster)
    }
    const maps = selected?.model.getObjectByName('maps')
    if (maps) maps.rotation.y = state.pointer.x * 0.4
    for (let i = 0; i < 4; i++) {
      const drone = selected?.model.getObjectByName(`drone-${i}`)
      if (drone)
        drone.position.y =
          0.3 + Math.max(0, 0.4 - Math.abs(state.pointer.x - Math.cos(i * 1.6))) * 0.6
    }
    const debris = selected?.model.getObjectByName('accretion')
    if (debris) debris.rotation.y = state.pointer.x * 0.035
    invalidate()
  }
  const start = (event: PointerEvent) => {
    if (event.button !== 0 || blocked(event)) return
    pointers.set(event.pointerId, new T.Vector2(event.clientX, event.clientY))
    down.set(event.clientX, event.clientY)
    lastMove = event.timeStamp
    state.velocity.set(0, 0)
    moved = pointers.size > 1 ? 10 : 0
    state.dragging = true
  }
  const end = (event: PointerEvent) => {
    if (!pointers.delete(event.pointerId)) return
    state.dragging = pointers.size > 0
    pinch = 0
    if (moved < 6 && event.type !== 'pointercancel') select(hit(event)?.key ?? null)
    invalidate()
  }
  const wheel = (event: WheelEvent) => {
    if (!event.ctrlKey || blocked(event)) return
    if (!state.selected || state.selected === 'club' || state.selected.startsWith('event-')) return
    event.preventDefault()
    if (performance.now() - wheelAt < 450) return
    wheelAt = performance.now()
    zoom(T.MathUtils.clamp(state.level + (event.deltaY < 0 ? 1 : -1), 0, 2))
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerdown', start)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
  window.addEventListener('wheel', wheel, { passive: false })
  return () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerdown', start)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    window.removeEventListener('wheel', wheel)
    document.body.style.cursor = ''
  }
}

import * as T from 'three'

export interface View {
  azimuth: number
  polar: number
  distance: number
  target: T.Vector3
}

const LIMITS = { polar: [0.05, 1.22], distance: [0.7, 5] } as const

const follow = (current: number, goal: number, blend: number) =>
  Math.abs(goal - current) < 1e-4 ? goal : current + (goal - current) * blend

export function createOrbit(camera: T.PerspectiveCamera) {
  const view: View = { azimuth: 0, polar: 0.001, distance: 3.6, target: new T.Vector3() }
  const goal: View = { azimuth: -0.42, polar: 0.92, distance: 3, target: new T.Vector3() }
  const home = { target: new T.Vector3(), distance: 3 }
  const clamp = () => {
    goal.polar = T.MathUtils.clamp(goal.polar, ...LIMITS.polar)
    goal.distance = T.MathUtils.clamp(goal.distance, ...LIMITS.distance)
  }
  const apply = () => {
    const ring = Math.sin(view.polar) * view.distance
    camera.position.set(
      view.target.x + Math.sin(view.azimuth) * ring,
      view.target.y + Math.cos(view.polar) * view.distance,
      view.target.z + Math.cos(view.azimuth) * ring,
    )
    camera.lookAt(view.target)
  }
  return {
    view,
    goal,
    step(seconds: number, speed = 5) {
      const blend = 1 - Math.exp(-seconds * speed)
      view.azimuth = follow(view.azimuth, goal.azimuth, blend)
      view.polar = follow(view.polar, goal.polar, blend)
      view.distance = follow(view.distance, goal.distance, blend)
      view.target.lerp(goal.target, blend)
      if (view.target.distanceToSquared(goal.target) < 1e-8) view.target.copy(goal.target)
      apply()
      return (
        view.azimuth !== goal.azimuth ||
        view.polar !== goal.polar ||
        view.distance !== goal.distance ||
        !view.target.equals(goal.target)
      )
    },
    rotate(dx: number, dy: number) {
      goal.azimuth -= dx * 0.006
      goal.polar -= dy * 0.004
      clamp()
    },
    zoom(factor: number) {
      goal.distance *= factor
      clamp()
    },
    aim(target: T.Vector3, distance: number, polar = goal.polar) {
      goal.target.copy(target)
      goal.distance = distance
      goal.polar = polar
      clamp()
    },
    snap() {
      view.azimuth = goal.azimuth
      view.polar = goal.polar
      view.distance = goal.distance
      view.target.copy(goal.target)
      apply()
    },
    frame(target: T.Vector3, distance: number) {
      home.target.copy(target)
      home.distance = distance
    },
    overview() {
      goal.polar = 0.92
      goal.distance = home.distance
      goal.target.copy(home.target)
      clamp()
    },
  }
}

export type Orbit = ReturnType<typeof createOrbit>

export function bindOrbit(
  canvas: HTMLCanvasElement,
  orbit: Orbit,
  poke: () => void,
  tap: (event: PointerEvent) => void,
  hover: (event: PointerEvent | null) => void,
) {
  const pointers = new Map<number, { x: number; y: number }>()
  let travel = 0
  let pinch = 0
  let engaged = false
  const down = (event: PointerEvent) => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    canvas.setPointerCapture(event.pointerId)
    travel = 0
    pinch = 0
    engaged = true
  }
  const move = (event: PointerEvent) => {
    const last = pointers.get(event.pointerId)
    if (!last) {
      if (event.pointerType === 'mouse') hover(event)
      return
    }
    const dx = event.clientX - last.x
    const dy = event.clientY - last.y
    last.x = event.clientX
    last.y = event.clientY
    travel += Math.abs(dx) + Math.abs(dy)
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y)
      if (pinch) orbit.zoom(pinch / Math.max(1, distance))
      pinch = distance
      orbit.rotate(0, dy / 2)
    } else orbit.rotate(dx, event.pointerType === 'touch' ? 0 : dy)
    poke()
  }
  const up = (event: PointerEvent) => {
    if (pointers.delete(event.pointerId) && travel < 6 && !pointers.size) tap(event)
    pinch = 0
  }
  const wheel = (event: WheelEvent) => {
    if (!engaged && !event.ctrlKey) return
    event.preventDefault()
    orbit.zoom(Math.exp(event.deltaY * (event.ctrlKey ? 0.01 : 0.0012)))
    poke()
  }
  const leave = () => {
    engaged = false
    hover(null)
  }
  canvas.addEventListener('pointerdown', down)
  canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', up)
  canvas.addEventListener('pointercancel', up)
  canvas.addEventListener('pointerleave', leave)
  canvas.addEventListener('wheel', wheel, { passive: false })
  return () => {
    canvas.removeEventListener('pointerdown', down)
    canvas.removeEventListener('pointermove', move)
    canvas.removeEventListener('pointerup', up)
    canvas.removeEventListener('pointercancel', up)
    canvas.removeEventListener('pointerleave', leave)
    canvas.removeEventListener('wheel', wheel)
  }
}

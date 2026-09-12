import * as T from 'three'
import { satelliteMotion } from './satellite-motion'
import { updateComet } from './comet'
import type { Body, SolarSystem } from './system'

export interface FlightState {
  selected: string | null
  hovered: string | null
  level: number
  pointer: T.Vector2
  dragging: boolean
  spin: T.Vector2
  velocity: T.Vector2
  base: number
  distance: number
  entry: number
  entryFrom: number
  chapter: 'near' | 'far'
  path: { value: number; keys: string[] }
}
interface Pose {
  look: T.Vector3
  direction: T.Vector3
  distance: number
}
const UP = new T.Vector3(0, 1, 0)
const OVERVIEW = new T.Vector3(0, 20, 28).normalize()
const DISTANT = new T.Vector3(0, 30, 21).normalize()
export const visibleHeight = (camera: T.PerspectiveCamera, distance: number) =>
  2 * distance * Math.tan(T.MathUtils.degToRad(camera.fov / 2))

const weights = (t: number) => {
  const t2 = t * t
  const t3 = t2 * t
  return [
    -0.5 * t3 + t2 - 0.5 * t,
    1.5 * t3 - 2.5 * t2 + 1,
    -1.5 * t3 + 2 * t2 + 0.5 * t,
    0.5 * t3 - 0.5 * t2,
  ]
}
const dwell = (f: number) => f + 0.35 * (f * f * (3 - 2 * f) - f)

function spring(
  current: T.Vector3,
  velocity: T.Vector3,
  target: T.Vector3,
  omega: number,
  dt: number,
) {
  const decay = Math.exp(-omega * dt)
  const change = current.clone().sub(target)
  const temp = velocity.clone().addScaledVector(change, omega).multiplyScalar(dt)
  velocity.addScaledVector(temp, -omega).multiplyScalar(decay)
  current.copy(target).add(change.add(temp).multiplyScalar(decay))
}

export function createFlight(system: SolarSystem, camera: T.PerspectiveCamera, state: FlightState) {
  const eye = new T.Vector3()
  const look = new T.Vector3()
  const eyeVelocity = new T.Vector3()
  const lookVelocity = new T.Vector3()
  const targetEye = new T.Vector3()
  let placed = false
  let spread = 0
  const pose = (key: string, sway: number): Pose => {
    const far = key === 'far'
    const body = system.bodies.find(item => item.key === key)
    const mobile = camera.aspect < 0.95
    const look = new T.Vector3()
    if (body) body.root.getWorldPosition(look)
    const level = key === state.selected ? state.level : 0
    const zoom = body
      ? body.parent
        ? 6
        : body.key === 'club'
          ? 2
          : (mobile ? [3.4, 4.9, 6.4] : [2.8, 4.1, 5.5])[level]!
      : 1
    const direction = (far ? DISTANT : OVERVIEW).clone()
    if (body?.parent) {
      const outward = look.clone().sub(body.parent.root.getWorldPosition(new T.Vector3()))
      direction
        .copy(outward)
        .setY(Math.max(3, outward.length() * 0.4))
        .normalize()
    } else if (body && body.key !== 'club') {
      const sun = look.clone().negate().setY(0).normalize()
      direction
        .copy(sun)
        .multiplyScalar(Math.cos(1.05))
        .addScaledVector(new T.Vector3().crossVectors(UP, sun), Math.sin(1.05))
        .setY(0.47)
        .normalize()
    }
    direction.applyAxisAngle(UP, sway)
    const right = new T.Vector3().crossVectors(UP, direction).normalize()
    const distance = (state.base / zoom) * (far ? 1.4 : 1)
    const height = visibleHeight(camera, distance)
    if (body && !mobile) look.addScaledVector(right, 1.25 / (zoom / 3.2))
    if (!body && !far && camera.aspect > 1.2)
      look.addScaledVector(right, -height * camera.aspect * 0.09)
    if (mobile)
      look.addScaledVector(
        new T.Vector3().crossVectors(direction, right).normalize(),
        -height * 0.24,
      )
    return { look, direction, distance }
  }
  const blend = (value: number, keys: string[], sway: number): Pose => {
    const last = keys.length - 1
    if (last < 1) return pose(keys[0] ?? 'overview', sway)
    const clamped = T.MathUtils.clamp(value, 0, last)
    const index = Math.min(Math.floor(clamped), last - 1)
    const f = dwell(clamped - index)
    const poses = [index - 1, index, index + 1, index + 2].map(i =>
      pose(keys[T.MathUtils.clamp(i, 0, last)]!, sway),
    )
    const w = weights(f)
    const look = new T.Vector3()
    let logDistance = 0
    poses.forEach((item, i) => {
      look.addScaledVector(item.look, w[i]!)
      logDistance += Math.log(item.distance) * w[i]!
    })
    const [, from, to] = poses as [Pose, Pose, Pose, Pose]
    const turn = new T.Quaternion().slerp(
      new T.Quaternion().setFromUnitVectors(from.direction, to.direction),
      f,
    )
    const separation = from.look.distanceTo(to.look) / Math.max(from.distance, to.distance)
    const lift = 1 + 4 * f * (1 - f) * T.MathUtils.clamp(separation * 0.35, 0, 0.6)
    return {
      look,
      direction: from.direction.clone().applyQuaternion(turn),
      distance: Math.exp(logDistance) * lift,
    }
  }
  return (delta: number, animated: boolean, seconds: number) => {
    const { value, keys } = state.path
    const nearest = keys[T.MathUtils.clamp(Math.round(value), 0, keys.length - 1)]
    const scrolled = nearest === 'overview' || nearest === 'far' ? null : (nearest ?? null)
    const far = state.chapter === 'far'
    const sway = animated && !far ? Math.sin(seconds * 0.11) * 0.03 : 0
    const target =
      state.selected === scrolled && state.level === 0
        ? blend(value, keys, sway)
        : pose(state.selected ?? (far ? 'far' : 'overview'), sway)
    if (animated && !far && !state.selected)
      target.direction
        .add(new T.Vector3(state.pointer.x * 0.016, state.pointer.y * 0.009, 0))
        .normalize()
    if (state.entry < 1) {
      const glide = 1 - Math.pow(1 - state.entry, 4)
      target.distance *= T.MathUtils.lerp(state.entryFrom, 1, glide)
      target.direction.applyAxisAngle(UP, (1 - glide) * 0.7)
    }
    targetEye.copy(target.look).addScaledVector(target.direction, target.distance)
    if (!placed || !animated || state.entry < 1) {
      eye.copy(targetEye)
      look.copy(target.look)
      eyeVelocity.set(0, 0, 0)
      lookVelocity.set(0, 0, 0)
      placed = true
    } else {
      spring(eye, eyeVelocity, targetEye, 3.4, delta)
      spring(look, lookVelocity, target.look, 3.4, delta)
    }
    camera.position.copy(eye)
    camera.lookAt(look)
    state.distance = eye.distanceTo(look)
    system.star.quaternion.copy(camera.quaternion)
    spread = animated
      ? spread + ((state.selected === 'club' ? 1 : 0) - spread) * (1 - Math.exp(-4 * delta))
      : state.selected === 'club'
        ? 1
        : 0
    system.star
      .getObjectByName('stations')
      ?.children.forEach(station => station.position.normalize().multiplyScalar(3.1 + 0.7 * spread))
    if (!state.dragging && animated) {
      const step = delta * 60
      state.velocity.addScaledVector(state.spin, -0.0012 * step)
      state.velocity.multiplyScalar(Math.exp(-3.8 * delta))
      state.spin.addScaledVector(state.velocity, step)
    }
    const selected = system.bodies.find(body => body.key === state.selected)
    if (selected && !selected.parent && selected.key !== 'club') {
      selected.model.rotation.set(state.spin.y, state.spin.x, 0)
      const detail = selected.model.getObjectByName('settlements')
      if (detail) detail.visible = state.level >= 1
    }
    const rest = (state.base * 1e-3) ** 2
    return (
      state.entry < 1 ||
      eyeVelocity.lengthSq() > rest ||
      lookVelocity.lengthSq() > rest ||
      eye.distanceToSquared(targetEye) > rest ||
      look.distanceToSquared(target.look) > rest
    )
  }
}
const PHASES = [-0.25, Math.PI + 0.55, -Math.PI / 2 - 0.2]
export function updateOrbits(
  system: SolarSystem,
  state: FlightState,
  seconds: number,
  opening: number,
  delta = 1 / 60,
) {
  const fade = 1 - Math.exp(-6 * delta)
  for (const body of system.bodies) {
    if (!body.distance) continue
    let angle = body.parent
      ? seconds / (38 + body.index * 13) + body.index * 2.1
      : seconds / (600 + body.index * 300) + (PHASES[body.index] ?? body.index * 2.1)
    if (body.status === 'postponed' && body.parent)
      angle = Math.atan2(body.parent.root.position.z, body.parent.root.position.x)
    if (
      state.selected === body.key ||
      state.selected === body.parent?.key ||
      state.hovered === body.key
    ) {
      angle = body.root.userData.angle ?? angle
    } else {
      angle = T.MathUtils.lerp(body.root.userData.angle ?? angle, angle, 1 - Math.exp(-2.5 * delta))
      body.root.userData.angle = angle
    }
    body.root.position.set(
      Math.cos(angle + (1 - opening) * 0.35) * body.distance,
      body.parent ? Math.sin(angle * 2) * 0.24 : 0,
      Math.sin(angle + (1 - opening) * 0.35) * body.distance,
    )
    body.root.scale.setScalar(
      body.current ? Math.max(0.001, (opening - 0.8) * 5) : Math.max(0.001, opening),
    )
    if (body.orbit) {
      body.orbit.visible = opening > 0.01
      body.orbit.geometry.setDrawRange(0, Math.floor(161 * opening))
      const material = body.orbit.material as T.LineBasicMaterial
      const target =
        state.hovered === body.key || state.selected === body.key
          ? 0.75
          : state.selected && state.selected !== body.parent?.key
            ? 0.06
            : 0.18
      material.opacity += (target - material.opacity) * fade
    }
    satelliteMotion(body, seconds)
  }
  system.comets.forEach(comet => {
    const origin = comet.parent?.root.position ?? new T.Vector3()
    const sweep = (((seconds / 32 + comet.index * 0.43) % 1) - 0.5) * 9
    const head = new T.Vector3(
      sweep,
      1.1 + Math.cos(sweep * 0.35) * 0.9,
      1.4 - sweep * sweep * 0.05,
    )
    updateComet(comet.root, head.add(origin), seconds)
  })
  const corona = system.star.getObjectByName('corona')
  if (corona) corona.rotation.z = Math.sin(seconds * 0.018) * 0.035
}
export function projectBody(body: Body, camera: T.Camera) {
  return body.root.getWorldPosition(new T.Vector3()).project(camera)
}
export const shown = (object: T.Object3D | null): boolean =>
  !object || (object.visible && shown(object.parent))

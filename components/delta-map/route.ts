import * as T from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import type { Plate } from './plate'

const WIDTH = 0.007
const LIFT = 0.008

export function buildRoute(plate: Plate, waypoints: [number, number][]) {
  const group = new T.Group()
  if (waypoints.length < 1) return group
  const path: T.Vector3[] = []
  waypoints.forEach(([x, y], index) => {
    const next = waypoints[index + 1]
    if (!next) {
      path.push(plate.world(x, y, LIFT))
      return
    }
    const steps = Math.max(1, Math.ceil(Math.hypot(next[0] - x, next[1] - y) / 0.002))
    for (let step = 0; step < steps; step++) {
      const t = step / steps
      path.push(plate.world(x + (next[0] - x) * t, y + (next[1] - y) * t, LIFT))
    }
  })
  const positions: number[] = []
  for (let index = 0; index + 1 < path.length; index++) {
    const a = path[index]!
    const b = path[index + 1]!
    const side = new T.Vector3(b.z - a.z, 0, a.x - b.x).normalize().multiplyScalar(WIDTH / 2)
    const [a1, a2, b1, b2] = [
      a.clone().add(side),
      a.clone().sub(side),
      b.clone().add(side),
      b.clone().sub(side),
    ]
    positions.push(
      ...a1.toArray(),
      ...a2.toArray(),
      ...b1.toArray(),
      ...b1.toArray(),
      ...a2.toArray(),
      ...b2.toArray(),
    )
  }
  const ribbon = new T.Mesh(
    new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(positions, 3)),
    new MeshBasicNodeMaterial({
      color: '#ffd166',
      side: T.DoubleSide,
      transparent: true,
      opacity: 0.95,
    }),
  )
  const stops = new T.InstancedMesh(
    new T.CylinderGeometry(1, 1, 1, 20),
    new MeshBasicNodeMaterial({ color: '#fff4d6' }),
    waypoints.length,
  )
  const matrix = new T.Matrix4()
  waypoints.forEach(([x, y], index) => {
    const size = index === 0 || index === waypoints.length - 1 ? 0.006 : 0.004
    matrix.compose(plate.world(x, y, LIFT), new T.Quaternion(), new T.Vector3(size, 0.004, size))
    stops.setMatrixAt(index, matrix)
  })
  group.add(ribbon, stops)
  return group
}

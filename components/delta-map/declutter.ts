import * as T from 'three'
import type { Box } from './anchors'

export interface IconSet {
  mesh: T.Mesh
  centers: T.Vector3[]
  pixels: number
  shown: Uint8Array
  firm: boolean
}

const TUCK = 0.36
const probe = new T.Vector3()

const covered = (x: number, y: number, radius: number, boxes: readonly Box[]) =>
  boxes.some(box => {
    const dx = x - T.MathUtils.clamp(x, box.x, box.x + box.width)
    const dy = y - T.MathUtils.clamp(y, box.y, box.y + box.height)
    return Math.hypot(dx, dy) < radius * 0.8
  })

export function declutter(
  sets: IconSet[],
  camera: T.Camera,
  width: number,
  height: number,
  labels: readonly Box[],
) {
  const cell = 32
  const grid = new Map<number, [number, number, number][]>()
  const key = (x: number, y: number) => (x + 1024) * 4096 + y + 1024
  const clear = (x: number, y: number, radius: number) => {
    const [cx, cy] = [Math.floor(x / cell), Math.floor(y / cell)]
    for (let gx = cx - 2; gx <= cx + 2; gx++)
      for (let gy = cy - 2; gy <= cy + 2; gy++)
        for (const [ox, oy, other] of grid.get(key(gx, gy)) ?? [])
          if (Math.hypot(ox - x, oy - y) < (radius + other) * 0.92) return false
    return true
  }
  for (const set of sets) {
    if (!set.mesh.parent?.visible) continue
    const radius = set.pixels / 2
    const order = set.centers.map((_, at) => at).sort((a, b) => set.shown[b]! - set.shown[a]!)
    const scale = set.mesh.geometry.getAttribute('scale') as T.BufferAttribute
    let changed = false
    for (const at of order) {
      probe.copy(set.centers[at]!).applyMatrix4(set.mesh.matrixWorld).project(camera)
      const x = (probe.x * 0.5 + 0.5) * width
      const y = (-probe.y * 0.5 + 0.5) * height
      const onScreen =
        probe.z < 1 && x > -radius && y > -radius && x < width + radius && y < height + radius
      const full = onScreen && clear(x, y, radius) && (set.firm || !covered(x, y, radius, labels))
      if (full) {
        const slot = key(Math.floor(x / cell), Math.floor(y / cell))
        grid.set(slot, [...(grid.get(slot) ?? []), [x, y, radius]])
      }
      if (set.shown[at] === Number(full)) continue
      set.shown[at] = Number(full)
      for (let corner = 0; corner < 4; corner++) scale.setX(at * 4 + corner, full ? 1 : TUCK)
      changed = true
    }
    if (changed) scale.needsUpdate = true
  }
}

export const hitRadius = (set: IconSet, at: number) =>
  (set.pixels / 2) * (set.shown[at] ? 1 : TUCK) + 3

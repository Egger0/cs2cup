import * as T from 'three'
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import { color, float, mix, positionLocal, smoothstep } from 'three/tsl'
import {
  SAND_KINDS,
  SAND_RISE,
  type DeltaMapData,
  type SandKind,
  type SandPoint,
} from '@/lib/delta-sand'
import { decode, type Plate } from './plate'

const SIZE: Record<SandKind, number> = {
  exit: 0.016,
  boss: 0.016,
  key: 0.012,
  vault: 0.009,
  spawn: 0.008,
}

export function buildBlocks(data: DeltaMapData, plate: Plate) {
  const n = data.grid
  const urban = decode(data.urban)
  const step = 2
  const mask = decode(data.mask)
  const dense = [...urban].filter((value, index) => value && mask[index]! >= 127)
  const floor = Math.max(48, dense.sort((a, b) => a - b)[Math.floor(dense.length * 0.85)] ?? 48)
  const cells: [number, number, number][] = []
  for (let row = 0; row < n - step; row += step)
    for (let col = 0; col < n - step; col += step) {
      let sum = 0
      for (let r = 0; r < step; r++)
        for (let c = 0; c < step; c++) sum += urban[(row + r) * n + col + c]!
      const density = sum / (step * step)
      const x = (col + step / 2) / (n - 1)
      const y = (row + step / 2) / (n - 1)
      if (density > floor && plate.inside(x, y)) cells.push([x, y, density])
    }
  const material = new MeshStandardNodeMaterial({ roughness: 0.62, metalness: 0.02 })
  material.colorNode = mix(
    color('#8d8a7f'),
    color('#e4dfd1'),
    smoothstep(-0.5, 0.5, positionLocal.y),
  )
  const mesh = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), material, Math.max(1, cells.length))
  const footprint = ((step * 2) / (n - 1)) * 0.78
  const matrix = new T.Matrix4()
  cells.forEach(([x, y, density], index) => {
    const tall = 0.01 + Math.min(1, (density - floor) / (256 - floor)) * 0.05
    const base = plate.world(x, y)
    matrix.compose(
      base.setY(base.y + tall / 2 - 0.004),
      new T.Quaternion(),
      new T.Vector3(footprint, tall, footprint),
    )
    mesh.setMatrixAt(index, matrix)
  })
  mesh.count = cells.length
  return mesh
}

export function buildMarkers(points: SandPoint[], plate: Plate) {
  const group = new T.Group()
  const heads: { mesh: T.InstancedMesh; points: SandPoint[] }[] = []
  const shape = new T.OctahedronGeometry(1, 0)
  for (const kind of Object.keys(SAND_KINDS) as SandKind[]) {
    const own = points.filter(point => point[0] === kind)
    if (!own.length) continue
    const tint = new T.Color(SAND_KINDS[kind].color)
    const head = new MeshBasicNodeMaterial()
    head.colorNode = color(tint).mul(1.25)
    const mesh = new T.InstancedMesh(shape, head, own.length)
    const beam = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
    beam.colorNode = color(tint)
    beam.opacityNode = float(0.45)
    const segments: T.Vector3[] = []
    const matrix = new T.Matrix4()
    own.forEach(([, x, y], index) => {
      const foot = plate.world(x, y)
      const top = plate.world(x, y, SAND_RISE[kind])
      segments.push(foot, top)
      matrix.compose(top, new T.Quaternion(), new T.Vector3().setScalar(SIZE[kind]))
      mesh.setMatrixAt(index, matrix)
    })
    const lines = new T.LineSegments(new T.BufferGeometry().setFromPoints(segments), beam)
    const kindGroup = new T.Group()
    kindGroup.name = kind
    kindGroup.add(lines, mesh)
    group.add(kindGroup)
    heads.push({ mesh, points: own })
  }
  return {
    group,
    heads,
    show(kinds: ReadonlySet<SandKind>) {
      group.children.forEach(child => (child.visible = kinds.has(child.name as SandKind)))
    },
  }
}

export type Markers = ReturnType<typeof buildMarkers>

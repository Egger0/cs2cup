import * as T from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { color, float } from 'three/tsl'
import { SAND_KINDS, SAND_RISE, type SandKind, type SandPoint } from '@/lib/delta-sand'
import type { Plate } from './plate'

const SIZE: Record<SandKind, number> = {
  exit: 0.016,
  boss: 0.016,
  key: 0.012,
  vault: 0.009,
  spawn: 0.008,
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

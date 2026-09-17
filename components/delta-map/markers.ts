import * as T from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { color, float } from 'three/tsl'
import { SAND_KINDS, type SandKind, type SandPoint } from '@/lib/delta-sand'

export type Place = (x: number, y: number, rise: number) => T.Vector3

const beamMaterial = (tint: T.Color, opacity: number) => {
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
  material.colorNode = color(tint)
  material.opacityNode = float(opacity)
  return material
}

export function buildMarkers(points: SandPoint[], place: Place, scale = 1) {
  const group = new T.Group()
  const heads: { mesh: T.InstancedMesh; points: SandPoint[] }[] = []
  const shape = new T.OctahedronGeometry(1, 0)
  for (const kind of Object.keys(SAND_KINDS) as SandKind[]) {
    const own = points.filter(point => point[0] === kind)
    if (!own.length) continue
    const { color: hex, rise } = SAND_KINDS[kind]
    const tint = new T.Color(hex)
    const head = new MeshBasicNodeMaterial()
    head.colorNode = color(tint).mul(1.25)
    const mesh = new T.InstancedMesh(shape, head, own.length)
    const beams: T.Vector3[] = []
    const links: T.Vector3[] = []
    const matrix = new T.Matrix4()
    const size = (0.004 + rise * 0.06) * scale
    own.forEach(([, x, y, , , , link], index) => {
      const top = place(x, y, rise * scale)
      beams.push(place(x, y, 0), top)
      matrix.compose(top, new T.Quaternion(), new T.Vector3().setScalar(size))
      mesh.setMatrixAt(index, matrix)
      for (let at = 0; link && at + 1 < link.length; at += 2)
        links.push(top, place(link[at]!, link[at + 1]!, 0.02))
    })
    const kindGroup = new T.Group()
    kindGroup.name = kind
    kindGroup.add(
      new T.LineSegments(new T.BufferGeometry().setFromPoints(beams), beamMaterial(tint, 0.45)),
      mesh,
    )
    if (links.length)
      kindGroup.add(
        new T.LineSegments(new T.BufferGeometry().setFromPoints(links), beamMaterial(tint, 0.9)),
      )
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

export function disposeTree(root: T.Object3D) {
  root.traverse(object => {
    if (object instanceof T.Mesh || object instanceof T.LineSegments || object instanceof T.Line) {
      object.geometry.dispose()
      for (const material of [object.material].flat()) material.dispose()
    }
  })
}

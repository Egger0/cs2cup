import * as T from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  color,
  float,
  length,
  mix,
  modelWorldMatrix,
  screenSize,
  smoothstep,
  step,
  texture,
  uniform,
  vec2,
  vec4,
} from 'three/tsl'
import { declutter, hitRadius, type IconSet } from './declutter'
import { ICON_ATLAS, SAND_KINDS, type SandKind, type SandPoint } from '@/lib/delta-sand'

export type Place = (x: number, y: number, rise: number) => T.Vector3

const PIXELS: Record<SandKind, number> = {
  exit: 34,
  boss: 32,
  key: 28,
  vault: 26,
  tech: 22,
  arms: 22,
  medical: 22,
  task: 24,
  special: 22,
  stash: 20,
  bags: 18,
  spawn: 22,
}

export const iconAtlas = texture(new T.Texture())
export const atlasRows = uniform(1)
const pixelRatio = uniform(1)

export const setIconRatio = (ratio: number) => (pixelRatio.value = ratio)

export function setAtlas(map: T.Texture) {
  iconAtlas.value = map
  atlasRows.value = Math.max(1, (map.image as HTMLImageElement).height / ICON_ATLAS.cell)
}

function iconMaterial(tint: T.Color, pixels: number) {
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
  const center = attribute<'vec3'>('center')
  const corner = attribute<'vec2'>('corner')
  const cell = attribute<'vec2'>('cell')
  const clip = cameraProjectionMatrix
    .mul(cameraViewMatrix)
    .mul(modelWorldMatrix)
    .mul(vec4(center, 1))
  const size = attribute<'float'>('scale')
  const offset = corner.mul(size.mul(pixels)).mul(pixelRatio).mul(2).div(screenSize).mul(clip.w)
  material.vertexNode = vec4(clip.xy.add(offset), clip.z, clip.w)
  const radius = length(corner)
  const disc = smoothstep(0.5, 0.45, radius)
  const ring = smoothstep(0.38, 0.42, radius).mul(disc)
  const inner = corner.div(0.74).add(0.5)
  const inside = step(0, inner.x).mul(step(inner.x, 1)).mul(step(0, inner.y)).mul(step(inner.y, 1))
  const known = step(0, cell.x)
  const lookup = cell
    .add(vec2(inner.x, float(1).sub(inner.y)))
    .div(vec2(ICON_ATLAS.columns, atlasRows))
  const icon = iconAtlas.sample(lookup)
  const full = step(0.99, size)
  const art = icon.a.mul(inside).mul(known).mul(full)
  const tone = color(tint)
  const plate = mix(
    color('#0b0d10'),
    tone,
    ring.max(known.oneMinus().mul(smoothstep(0.2, 0.16, radius))).max(full.oneMinus()),
  )
  material.colorNode = mix(plate, icon.rgb.mul(1.1), art)
  material.opacityNode = disc.mul(0.9).max(art)
  return material
}

export function buildMarkers(points: SandPoint[], place: Place, scale = 1) {
  const group = new T.Group()
  const sets: (IconSet & { points: SandPoint[] })[] = []
  for (const kind of Object.keys(SAND_KINDS) as SandKind[]) {
    const own = points.filter(point => point[0] === kind)
    if (!own.length) continue
    const { color: hex, rise } = SAND_KINDS[kind]
    const tint = new T.Color(hex)
    const lift = rise * 0.55 * scale
    const beams: T.Vector3[] = []
    const links: T.Vector3[] = []
    const centers: T.Vector3[] = []
    const vertex = { center: [] as number[], corner: [] as number[], cell: [] as number[] }
    const index: number[] = []
    own.forEach(([, x, y, , , icon, , link], at) => {
      const top = place(x, y, lift)
      centers.push(top)
      beams.push(place(x, y, 0), top)
      for (let step = 0; link && step + 1 < link.length; step += 2)
        links.push(top, place(link[step]!, link[step + 1]!, 0.02))
      const column = icon >= 0 ? icon % ICON_ATLAS.columns : -1
      const row = icon >= 0 ? Math.floor(icon / ICON_ATLAS.columns) : -1
      for (const [cx, cy] of [
        [-0.5, -0.5],
        [0.5, -0.5],
        [0.5, 0.5],
        [-0.5, 0.5],
      ]) {
        vertex.center.push(top.x, top.y, top.z)
        vertex.corner.push(cx!, cy!)
        vertex.cell.push(column, row)
      }
      const base = at * 4
      index.push(base, base + 1, base + 2, base, base + 2, base + 3)
    })
    const geometry = new T.BufferGeometry()
    geometry.setAttribute('position', new T.Float32BufferAttribute(vertex.center, 3))
    geometry.setAttribute('center', new T.Float32BufferAttribute(vertex.center, 3))
    geometry.setAttribute('corner', new T.Float32BufferAttribute(vertex.corner, 2))
    geometry.setAttribute('cell', new T.Float32BufferAttribute(vertex.cell, 2))
    geometry.setAttribute(
      'scale',
      new T.Float32BufferAttribute(new Float32Array(own.length * 4).fill(1), 1),
    )
    geometry.setIndex(index)
    const pixels = PIXELS[kind] * Math.min(1, 0.4 + scale)
    const mesh = new T.Mesh(geometry, iconMaterial(tint, pixels))
    mesh.frustumCulled = false
    mesh.renderOrder = 2
    const beam = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
    beam.colorNode = color(tint)
    beam.opacityNode = float(0.35)
    const kindGroup = new T.Group()
    kindGroup.name = kind
    kindGroup.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(beams), beam), mesh)
    if (links.length) {
      const link = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
      link.colorNode = color(tint)
      link.opacityNode = float(0.9)
      kindGroup.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(links), link))
    }
    group.add(kindGroup)
    sets.push({ mesh, centers, points: own, pixels, shown: new Uint8Array(own.length).fill(1) })
  }
  const probe = new T.Vector3()
  return {
    group,
    show(kinds: ReadonlySet<SandKind>) {
      group.children.forEach(child => (child.visible = kinds.has(child.name as SandKind)))
    },
    settle(camera: T.Camera, width: number, height: number) {
      if (group.visible) declutter(sets, camera, width, height)
    },
    pick(x: number, y: number, camera: T.Camera, width: number, height: number) {
      let best: SandPoint | null = null
      let nearest = Infinity
      if (!group.visible) return best
      for (const set of sets) {
        if (!set.mesh.parent?.visible) continue
        for (const [at, center] of set.centers.entries()) {
          probe.copy(center).applyMatrix4(set.mesh.matrixWorld).project(camera)
          if (probe.z > 1) continue
          const distance = Math.hypot(
            (probe.x * 0.5 + 0.5) * width - x,
            (-probe.y * 0.5 + 0.5) * height - y,
          )
          if (distance > hitRadius(set, at) || probe.z >= nearest) continue
          nearest = probe.z
          best = set.points[at]!
        }
      }
      return best
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

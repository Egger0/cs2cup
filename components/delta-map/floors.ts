import * as T from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { float, min, smoothstep, texture, uniform, uv } from 'three/tsl'
import { floorImageUrl, type DeltaMapData, type SandKind, type SandPoint } from '@/lib/delta-sand'
import { buildMarkers, disposeTree, type Markers } from './markers'
import type { Plate } from './plate'

const loader = new T.TextureLoader()
const INDOOR: SandKind[] = [
  'exit',
  'boss',
  'key',
  'vault',
  'tech',
  'arms',
  'medical',
  'task',
  'special',
]

const outline = (side: number) =>
  new T.BufferGeometry().setFromPoints(
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
      [-1, -1],
    ].map(([x, z]) => new T.Vector3((x! * side) / 2, 0, (z! * side) / 2)),
  )

export function buildFloorStack(
  data: DeltaMapData,
  plate: Plate,
  index: number,
  points: SandPoint[],
  changed: () => void,
) {
  const building = data.buildings[index]!
  const bounds = new T.Box2()
  for (const [x, y, size] of building.frames)
    bounds
      .expandByPoint(new T.Vector2(x - size / 2, y - size / 2))
      .expandByPoint(new T.Vector2(x + size / 2, y + size / 2))
  const extent = Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y) * 2
  const middle = bounds.getCenter(new T.Vector2())
  const base = plate.heightAt(building.x, building.y) + 0.03
  const gap = T.MathUtils.clamp(extent * 0.22, 0.05, 0.14)
  const group = new T.Group()
  const maps: T.Texture[] = []
  const plates: {
    code: string
    mesh: T.Mesh
    opacity: ReturnType<typeof uniform>
    markers: Markers
  }[] = []
  let expansion = 0
  let target = 1
  const heightOf = (floor: number, spread = expansion) => base + gap * (floor + 1) * spread

  building.floors.forEach((code, floor) => {
    const [fx, fy, size] = building.frames[floor]!
    const side = size * 2
    const opacity = uniform(0.3)
    const art = texture(new T.Texture())
    const material = new MeshBasicNodeMaterial({
      transparent: true,
      side: T.DoubleSide,
      depthWrite: false,
    })
    const edge = min(min(uv().x, uv().y), min(uv().x.oneMinus(), uv().y.oneMinus()))
    material.colorNode = art.rgb.mul(1.9)
    material.opacityNode = float(opacity).mul(smoothstep(0, 0.12, edge))
    void loader.loadAsync(floorImageUrl(data.id, index, code)).then(map => {
      map.colorSpace = T.SRGBColorSpace
      map.flipY = false
      maps.push(map)
      art.value = map
      changed()
    })
    const geometry = new T.PlaneGeometry(side, side).rotateX(-Math.PI / 2)
    const uvs = geometry.getAttribute('uv')
    for (let at = 0; at < uvs.count; at++) uvs.setY(at, 1 - uvs.getY(at))
    const mesh = new T.Mesh(geometry, material)
    mesh.position.set(fx * 2 - 1, 0, fy * 2 - 1)
    mesh.add(
      new T.Line(
        outline(side),
        new MeshBasicNodeMaterial({ color: '#9bcaeb', transparent: true, opacity: 0.25 }),
      ),
    )
    const markers = buildMarkers(
      points.filter(point => point[5] === `${index}:${code}`),
      (x, y, rise) => new T.Vector3((x - fx) * 2, rise * 0.4 + 0.004, (y - fy) * 2),
      0.6,
    )
    mesh.add(markers.group)
    group.add(mesh)
    plates.push({ code, mesh, opacity, markers })
  })

  const pillars = new T.LineSegments(
    new T.BufferGeometry(),
    new MeshBasicNodeMaterial({ color: '#9bcaeb', transparent: true, opacity: 0.3 }),
  )
  group.add(pillars)
  const corners = [
    [bounds.min.x, bounds.min.y],
    [bounds.max.x, bounds.min.y],
    [bounds.max.x, bounds.max.y],
    [bounds.min.x, bounds.max.y],
  ].map(([x, y]) => [x! * 2 - 1, y! * 2 - 1] as const)

  return {
    group,
    center: () =>
      new T.Vector3(
        middle.x * 2 - 1,
        heightOf((building.floors.length - 1) / 2, 1),
        middle.y * 2 - 1,
      ),
    distance: Math.max(0.5, extent * 2.1 + gap * building.floors.length),
    heads: () =>
      plates.filter(entry => entry.markers.group.visible).flatMap(entry => entry.markers.heads),
    anchor(code: string, x: number, y: number, rise: number) {
      const floor = building.floors.indexOf(code)
      if (floor < 0) return null
      return new T.Vector3(x * 2 - 1, heightOf(floor) + rise * 0.4 + 0.02, y * 2 - 1)
    },
    labelAt(code: string) {
      const floor = building.floors.indexOf(code)
      return new T.Vector3(corners[0]![0], heightOf(floor), corners[0]![1])
    },
    focus(code: string | null, kinds: ReadonlySet<SandKind>) {
      const indoor = new Set([...INDOOR, ...kinds])
      for (const entry of plates) {
        entry.opacity.value = code === null ? 0.8 : entry.code === code ? 1 : 0.14
        entry.markers.show(indoor)
        entry.markers.group.visible = entry.code === code
      }
    },
    collapse() {
      target = 0
    },
    step(seconds: number, still: boolean) {
      expansion = still ? target : expansion + (target - expansion) * (1 - Math.exp(-seconds * 6))
      if (Math.abs(target - expansion) < 0.002) expansion = target
      plates.forEach((entry, floor) => (entry.mesh.position.y = heightOf(floor)))
      pillars.geometry.dispose()
      pillars.geometry = new T.BufferGeometry().setFromPoints(
        corners.flatMap(([x, z]) => [
          new T.Vector3(x, base - 0.03, z),
          new T.Vector3(x, heightOf(building.floors.length - 1), z),
        ]),
      )
      return expansion !== target
    },
    gone: () => target === 0 && expansion === 0,
    dispose() {
      maps.forEach(map => map.dispose())
      disposeTree(group)
    },
  }
}

export type FloorStack = ReturnType<typeof buildFloorStack>

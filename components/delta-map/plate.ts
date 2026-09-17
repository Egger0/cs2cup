import * as T from 'three'
import { MeshStandardNodeMaterial, type Node } from 'three/webgpu'
import {
  abs,
  attribute,
  color,
  float,
  fract,
  fwidth,
  min,
  mix,
  positionLocal,
  smoothstep,
  texture,
} from 'three/tsl'
import { mapImageUrl, type DeltaMapData } from '@/lib/delta-sand'

const EXAGGERATION = 2.4
const DEPTH = 0.09
const WATER = 0.07
const loader = new T.TextureLoader()

export const decode = (text: string) => Uint8Array.from(atob(text), char => char.charCodeAt(0))

export async function loadImagery(id: string, size: 1024 | 2048) {
  const map = await loader.loadAsync(mapImageUrl(id, size))
  await (map.image as HTMLImageElement).decode().catch(() => {})
  map.colorSpace = T.SRGBColorSpace
  map.flipY = false
  map.anisotropy = 8
  return map
}

const line = (value: Node<'float'>, spacing: number, width: number) => {
  const phase = fract(value.div(spacing).add(0.5))
  const distance = min(phase, phase.oneMinus()).mul(spacing)
  return float(1).sub(smoothstep(0, fwidth(value).mul(width).max(1e-6), distance))
}

function surfaceMaterial(data: DeltaMapData, lift: number, art: ReturnType<typeof texture>) {
  const surface = new MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 })
  const y = positionLocal.y
  const edge = attribute<'float'>('edge')
  const land = smoothstep(lift * WATER, lift * (WATER + 0.06), y)
  const zone = mix(float(0.66), float(1), smoothstep(0.3, 0.5, edge))
  const boundary = float(1).sub(smoothstep(0, fwidth(edge).mul(1.6), abs(edge.sub(0.498))))
  const cell = (100 / data.meters) * 2
  const offset = positionLocal.add(cell / 2)
  const grid = line(offset.x, cell, 0.8).max(line(offset.z, cell, 0.8))
  const accent = color('#9bcaeb')
  surface.colorNode = art.rgb
    .mul(1.75)
    .mul(zone)
    .add(
      color('#d8b169').mul(
        line(y, lift / 4, 1.2)
          .mul(land)
          .mul(0.1),
      ),
    )
    .add(accent.mul(grid.mul(0.035)))
  surface.emissiveNode = accent.mul(boundary.mul(0.9))
  return surface
}

export function buildPlate(data: DeltaMapData, map: T.Texture) {
  const n = data.grid
  const height = decode(data.height)
  const mask = decode(data.mask)
  const lift = Math.min(0.42, Math.max(0.12, (data.relief / data.meters) * 2 * EXAGGERATION))
  const toWorld = (grid: number) => (grid / (n - 1)) * 2 - 1
  const cellHeight = (col: number, row: number) => (height[row * n + col]! / 255) * lift
  const heightAt = (x: number, y: number) => {
    const gx = T.MathUtils.clamp(x, 0, 1) * (n - 1)
    const gy = T.MathUtils.clamp(y, 0, 1) * (n - 1)
    const x0 = Math.min(n - 2, Math.floor(gx))
    const y0 = Math.min(n - 2, Math.floor(gy))
    const tx = gx - x0
    const ty = gy - y0
    return (
      (cellHeight(x0, y0) * (1 - tx) + cellHeight(x0 + 1, y0) * tx) * (1 - ty) +
      (cellHeight(x0, y0 + 1) * (1 - tx) + cellHeight(x0 + 1, y0 + 1) * tx) * ty
    )
  }

  const top = new T.PlaneGeometry(2, 2, n - 1, n - 1).rotateX(-Math.PI / 2)
  const positions = top.getAttribute('position')
  const uvs = top.getAttribute('uv')
  const edge = new Float32Array(n * n)
  const box = new T.Box3()
  for (let row = 0; row < n; row++)
    for (let col = 0; col < n; col++) {
      const index = row * n + col
      const point = new T.Vector3(toWorld(col), cellHeight(col, row), toWorld(row))
      positions.setXYZ(index, point.x, point.y, point.z)
      uvs.setXY(index, col / (n - 1), row / (n - 1))
      edge[index] = mask[index]! / 255
      if (mask[index]! >= 127) box.expandByPoint(point)
    }
  top.setAttribute('edge', new T.BufferAttribute(edge, 1))
  top.computeVertexNormals()

  const rim = (col: number, row: number) =>
    [toWorld(col), Math.max(cellHeight(col, row), lift * WATER), toWorld(row)] as const
  const perimeter = [
    ...Array.from({ length: n }, (_, i) => [i, 0] as const),
    ...Array.from({ length: n - 1 }, (_, i) => [n - 1, i + 1] as const),
    ...Array.from({ length: n - 1 }, (_, i) => [n - 2 - i, n - 1] as const),
    ...Array.from({ length: n - 1 }, (_, i) => [0, n - 2 - i] as const),
  ]
  const sides: number[] = []
  for (let i = 0; i + 1 < perimeter.length; i++) {
    const [ax, ay, az] = rim(...perimeter[i]!)
    const [bx, by, bz] = rim(...perimeter[i + 1]!)
    sides.push(ax, ay, az, ax, -DEPTH, az, bx, by, bz, bx, by, bz, ax, -DEPTH, az, bx, -DEPTH, bz)
  }
  const wall = new T.BufferGeometry()
  wall.setAttribute('position', new T.Float32BufferAttribute(sides, 3))
  wall.computeVertexNormals()
  const wallSurface = new MeshStandardNodeMaterial({ roughness: 0.95, side: T.DoubleSide })
  wallSurface.colorNode = mix(
    color('#0c0d0c'),
    color('#2b2c26'),
    line(positionLocal.y, DEPTH / 5, 1).mul(0.6),
  )

  const water = new T.Mesh(
    new T.PlaneGeometry(2, 2).rotateX(-Math.PI / 2).translate(0, lift * WATER, 0),
    new MeshStandardNodeMaterial({
      color: '#3a6a86',
      transparent: true,
      opacity: 0.32,
      roughness: 0.14,
      metalness: 0,
    }),
  )
  const art = texture(map)
  const surface = new T.Mesh(top, surfaceMaterial(data, lift, art))
  const mesh = new T.Group()
  mesh.add(surface, new T.Mesh(wall, wallSurface), water)
  const size = box.getSize(new T.Vector3())
  return {
    mesh,
    lift,
    center: box.getCenter(new T.Vector3()).setY(lift * 0.3),
    radius: Math.max(size.x, size.z) * 0.72,
    heightAt,
    world: (x: number, y: number, rise = 0) =>
      new T.Vector3(x * 2 - 1, heightAt(x, y) + rise, y * 2 - 1),
    dispose: () => art.value.dispose(),
    swap(next: T.Texture) {
      art.value.dispose()
      art.value = next
    },
  }
}

export type Plate = ReturnType<typeof buildPlate>

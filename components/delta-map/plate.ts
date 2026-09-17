import * as T from 'three'
import { MeshStandardNodeMaterial, type Node } from 'three/webgpu'
import {
  attribute,
  color,
  float,
  fract,
  fwidth,
  min,
  mix,
  positionLocal,
  smoothstep,
} from 'three/tsl'
import type { DeltaMapData } from '@/lib/delta-sand'
import { isolines } from '@/lib/isolines'

const EXAGGERATION = 2.4
const DEPTH = 0.09
const EDGE = 127

export const decode = (text: string) => Uint8Array.from(atob(text), char => char.charCodeAt(0))

const line = (value: Node<'float'>, spacing: number, width: number) => {
  const phase = fract(value.div(spacing).add(0.5))
  const distance = min(phase, phase.oneMinus()).mul(spacing)
  const blur = fwidth(value).mul(width).max(1e-6)
  return float(1).sub(smoothstep(0, blur, distance))
}

function surfaceMaterial(data: DeltaMapData, lift: number) {
  const surface = new MeshStandardNodeMaterial({ roughness: 0.88, metalness: 0.04 })
  const y = positionLocal.y
  const minor = line(y, lift / 16, 1.1)
  const major = line(y, lift / 4, 1.6)
  const cell = (100 / data.meters) * 2
  const offset = positionLocal.add(cell / 2)
  const grid = line(offset.x, cell, 0.9).max(line(offset.z, cell, 0.9))
  const ground = mix(color('#1b1e1b'), color('#51523f'), y.div(lift).clamp(0, 1).pow(0.8))
  const gold = color('#d8b169')
  surface.colorNode = mix(ground, gold, minor.mul(0.28).max(major.mul(0.75))).add(
    color('#9bcaeb').mul(grid.mul(0.05)),
  )
  surface.emissiveNode = gold.mul(major.mul(0.22).add(minor.mul(0.05)))
  surface.maskNode = attribute<'float'>('edge').greaterThanEqual(EDGE / 255)
  return surface
}

function wallMaterial() {
  const wall = new MeshStandardNodeMaterial({ roughness: 0.95, side: T.DoubleSide })
  wall.colorNode = mix(color('#0c0d0c'), color('#2b2c26'), line(positionLocal.y, DEPTH / 5, 1))
  return wall
}

export function buildPlate(data: DeltaMapData) {
  const n = data.grid
  const height = decode(data.height)
  const mask = decode(data.mask)
  const lift = Math.min(0.42, Math.max(0.12, (data.relief / data.meters) * 2 * EXAGGERATION))
  const toWorld = (grid: number) => (grid / (n - 1)) * 2 - 1
  const sample = (values: Uint8Array, gx: number, gy: number) => {
    const x = T.MathUtils.clamp(gx, 0, n - 1)
    const y = T.MathUtils.clamp(gy, 0, n - 1)
    const x0 = Math.min(n - 2, Math.floor(x))
    const y0 = Math.min(n - 2, Math.floor(y))
    const tx = x - x0
    const ty = y - y0
    const at = (col: number, row: number) => values[row * n + col]!
    return (
      (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) +
      (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty
    )
  }
  const heightAt = (x: number, y: number) => (sample(height, x * (n - 1), y * (n - 1)) / 255) * lift

  const positions = new Float32Array(n * n * 3)
  const edge = new Float32Array(n * n)
  const box = new T.Box3()
  for (let row = 0; row < n; row++)
    for (let col = 0; col < n; col++) {
      const index = row * n + col
      const point = new T.Vector3(toWorld(col), (height[index]! / 255) * lift, toWorld(row))
      positions.set(point.toArray(), index * 3)
      edge[index] = mask[index]! / 255
      if (mask[index]! >= EDGE) box.expandByPoint(point)
    }
  const indices: number[] = []
  const near = (index: number) => mask[index]! >= EDGE / 3
  for (let row = 0; row < n - 1; row++)
    for (let col = 0; col < n - 1; col++) {
      const a = row * n + col
      const b = a + 1
      const c = a + n
      const d = c + 1
      if (near(a) || near(b) || near(c) || near(d)) indices.push(a, c, b, b, c, d)
    }
  const top = new T.BufferGeometry()
  top.setAttribute('position', new T.BufferAttribute(positions, 3))
  top.setAttribute('edge', new T.BufferAttribute(edge, 1))
  top.setIndex(indices)
  top.computeVertexNormals()

  const sides: number[] = []
  for (const [[ax, ay], [bx, by]] of isolines(mask, n, EDGE)) {
    const ha = (sample(height, ax, ay) / 255) * lift
    const hb = (sample(height, bx, by) / 255) * lift
    const [wax, waz, wbx, wbz] = [toWorld(ax), toWorld(ay), toWorld(bx), toWorld(by)]
    sides.push(wax, ha, waz, wax, -DEPTH, waz, wbx, hb, wbz)
    sides.push(wbx, hb, wbz, wax, -DEPTH, waz, wbx, -DEPTH, wbz)
  }
  const wall = new T.BufferGeometry()
  wall.setAttribute('position', new T.Float32BufferAttribute(sides, 3))
  wall.computeVertexNormals()

  const mesh = new T.Group()
  mesh.add(new T.Mesh(top, surfaceMaterial(data, lift)), new T.Mesh(wall, wallMaterial()))
  const center = box.getCenter(new T.Vector3()).setY(lift * 0.3)
  const size = box.getSize(new T.Vector3())
  return {
    mesh,
    lift,
    center,
    radius: Math.max(size.x, size.z) * 0.58,
    heightAt,
    inside: (x: number, y: number) => sample(mask, x * (n - 1), y * (n - 1)) >= EDGE,
    world: (x: number, y: number, rise = 0) =>
      new T.Vector3(x * 2 - 1, heightAt(x, y) + rise, y * 2 - 1),
  }
}

export type Plate = ReturnType<typeof buildPlate>

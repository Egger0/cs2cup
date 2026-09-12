import * as T from 'three'
import { settlements } from './settlements.ts'
import { crystalPanels } from './crystal-panels.ts'
import { terrainContours } from './contours.ts'

export const palette = { blue: '#9BCAEB', gold: '#8D661F', dark: '#111210' }
export const random = (n: number) => {
  const value = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return value - Math.floor(value)
}
export function noise(x: number, y: number, z: number) {
  const field = (x: number, y: number, z: number) => {
    const ix = Math.floor(x),
      iy = Math.floor(y),
      iz = Math.floor(z)
    const smooth = (v: number) => v * v * (3 - 2 * v)
    const u = smooth(x - ix),
      v = smooth(y - iy),
      w = smooth(z - iz)
    let value = 0
    for (let a = 0; a < 2; a++)
      for (let b = 0; b < 2; b++)
        for (let c = 0; c < 2; c++) {
          value +=
            random((ix + a) * 13 + (iy + b) * 311 + (iz + c) * 757) *
            (a ? u : 1 - u) *
            (b ? v : 1 - v) *
            (c ? w : 1 - w)
        }
    return value * 2 - 1
  }
  return (
    field(x * 6, y * 6, z * 6) * 0.6 +
    field(x * 19, y * 19, z * 19) * 0.25 +
    field(x * 53, y * 53, z * 53) * 0.15
  )
}
export function arc(radius: number, color: string, start = 0, length = Math.PI * 2) {
  const points = Array.from({ length: 161 }, (_, i) => {
    const angle = start + (i / 160) * length
    return new T.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
  })
  return new T.Line(
    new T.BufferGeometry().setFromPoints(points),
    new T.LineBasicMaterial({ color, transparent: true, opacity: 0.3 }),
  )
}
export function cube(size: number, color: string, emissive = false) {
  return new T.Mesh(
    new T.BoxGeometry(size, size, size),
    new T.MeshStandardMaterial({
      color,
      roughness: 0.72,
      metalness: 0.25,
      emissive: emissive ? color : '#000000',
      emissiveIntensity: emissive ? 0.65 : 0,
    }),
  )
}
export function makeTerrain(kind: string, accent: string) {
  const group = new T.Group()
  const crystalline = kind === 'VALORANT'
  const geometry = crystalline ? new T.IcosahedronGeometry(1, 4) : new T.SphereGeometry(1, 144, 96)
  const position = geometry.getAttribute('position')
  const colors = []
  const base = new T.Color(accent)
  for (let i = 0; i < position.count; i++) {
    const p = new T.Vector3().fromBufferAttribute(position, i).normalize()
    const height = noise(p.x, p.y, p.z)
    const canyon = Math.pow(Math.abs(Math.sin(p.x * 9 + p.z * 6 + Math.sin(p.y * 12))), 0.18)
    const radius = crystalline
      ? 1 + Math.floor(height * 9) * 0.018
      : 0.994 + canyon * 0.004 + height * 0.012
    position.setXYZ(i, p.x * radius, p.y * radius, p.z * radius)
    const color = base.clone().multiplyScalar(0.93 + canyon * 0.16 + height * 0.12)
    if (kind === 'CS2' && p.y > 0.72)
      color.lerp(new T.Color('#9db3c4'), Math.min(1, (p.y - 0.72) * 3.2))
    colors.push(color.r, color.g, color.b)
  }
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  const surface = new T.Mesh(
    geometry,
    new T.MeshStandardMaterial({
      vertexColors: true,
      roughness: crystalline ? 0.32 : 0.93,
      metalness: crystalline ? 0.5 : 0.02,
      flatShading: crystalline,
    }),
  )
  surface.name = 'surface'
  group.add(surface)
  if (crystalline) {
    group.add(crystalPanels(geometry, accent))
    const seams = new T.LineSegments(
      new T.EdgesGeometry(geometry, 22),
      new T.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.5 }),
    )
    seams.name = 'seams'
    group.add(seams)
    for (let i = 0; i < 32; i++) {
      const fragment = new T.Mesh(
        new T.OctahedronGeometry(0.035 + random(i) * 0.06),
        new T.MeshStandardMaterial({ color: accent, metalness: 0.6, roughness: 0.3 }),
      )
      const a = random(i + 4) * Math.PI * 2
      fragment.name = `fragment-${i}`
      fragment.position.set(Math.cos(a) * 1.13, (random(i + 2) - 0.5) * 0.8, Math.sin(a) * 1.13)
      group.add(fragment)
    }
  }
  if (kind === 'CS2') {
    group.add(settlements(random))
    for (let i = 0; i < 90; i++) {
      const light = cube(0.006, palette.blue, true)
      const a = random(i) * Math.PI * 2
      const y = random(i + 200) * 1.6 - 0.8
      light.position
        .set(Math.cos(a) * Math.sqrt(1 - y * y), y, Math.sin(a) * Math.sqrt(1 - y * y))
        .multiplyScalar(1.025)
      group.add(light)
    }
  }
  if (kind === 'Delta') {
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i)
      const formed = 0.8 + 0.2 * T.MathUtils.smoothstep(x, -0.55, 0.15)
      position.setXYZ(i, x * formed, position.getY(i) * formed, position.getZ(i) * formed)
    }
    geometry.computeVertexNormals()
    group.add(terrainContours(geometry, noise))
    for (let i = 0; i < 13; i++) {
      const y = (i - 6) * 0.14
      const line = arc(Math.sqrt(1 - y * y) * 1.027, '#a8b991')
      line.material.opacity = 0.1
      line.position.y = y
      group.add(line)
    }
    const debris = new T.Group()
    debris.name = 'accretion'
    const rock = new T.IcosahedronGeometry(1, 0)
    const mineral = new T.MeshStandardMaterial({
      color: accent,
      roughness: 0.92,
      flatShading: true,
    })
    for (let i = 0; i < 220; i++) {
      const stone = new T.Mesh(rock, mineral)
      const size = 0.009 + random(i) * 0.024
      stone.scale.set(
        size * (0.7 + random(i + 31) * 0.6),
        size * (0.6 + random(i + 47) * 0.5),
        size * (0.8 + random(i + 59) * 0.5),
      )
      const a = random(i + 7) * Math.PI + Math.PI / 2
      const r = 1.05 + random(i + 18) * 0.65
      stone.position.set(Math.cos(a) * r, (random(i + 3) - 0.5) * 0.22, Math.sin(a) * r)
      stone.rotation.set(i, i * 0.7, i * 0.3)
      debris.add(stone)
    }
    group.add(debris)
    for (let i = 0; i < 4; i++) {
      const drone = cube(0.045, '#b0c59b', true)
      drone.name = `drone-${i}`
      drone.position.set(Math.cos(i * 1.6) * 1.17, 0.3, Math.sin(i * 1.6) * 1.17)
      group.add(drone)
    }
  }
  return group
}

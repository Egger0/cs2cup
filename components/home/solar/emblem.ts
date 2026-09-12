import * as T from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { color, float, uv } from 'three/tsl'
import { SVGLoader, type StrokeStyle } from 'three/addons/loaders/SVGLoader.js'
import { random, cube, palette } from './terrain'

export async function makeEmblem() {
  const response = await fetch('/brand/club-mark.svg')
  if (!response.ok) throw new Error('Club mark unavailable')
  const data = new SVGLoader().parse(await response.text())
  const group = new T.Group()
  const scale = 2.5 / 204
  for (const path of data.paths) {
    const style = path.userData?.style as StrokeStyle & { fill: string }
    const geometries: T.BufferGeometry[] = []
    if (style.fill && style.fill !== 'none') {
      for (const shape of path.toShapes()) {
        geometries.push(
          new T.ExtrudeGeometry(shape, { depth: 10, bevelEnabled: false, curveSegments: 48 }),
        )
      }
    } else {
      for (const subpath of path.subPaths) {
        const geometry = SVGLoader.pointsToStroke(subpath.getPoints(192), style, 16)
        if (geometry) geometries.push(geometry)
      }
    }
    for (const geometry of geometries) {
      const p = geometry.getAttribute('position')
      for (let i = 0; i < p.count; i++) {
        const x = (p.getX(i) - 220) * scale
        const y = (220 - p.getY(i)) * scale
        const z =
          style.fill !== 'none'
            ? 0.38 + p.getZ(i) * scale
            : Math.sqrt(Math.max(0, 1 - (x * x + y * y) / 6.5)) * 0.22
        p.setXYZ(i, x, y, z)
      }
      geometry.computeVertexNormals()
      group.add(
        new T.Mesh(
          geometry,
          new T.MeshBasicMaterial({
            color:
              style.fill !== 'none'
                ? new T.Color('#9BCAEB').multiplyScalar(1.9)
                : new T.Color('#2477B9').multiplyScalar(2.4),
            side: T.DoubleSide,
          }),
        ),
      )
    }
  }
  const shell = new T.Mesh(
    new T.SphereGeometry(2.46, 96, 64),
    new T.MeshBasicMaterial({
      color: '#0B4D87',
      transparent: true,
      opacity: 0.065,
      depthWrite: false,
    }),
  )
  shell.scale.z = 0.085
  shell.position.z = -0.25
  group.add(shell)
  const corona = new T.Group()
  corona.name = 'corona'
  for (let i = 0; i < 160; i++) {
    const angle = random(i) * Math.PI * 2
    const r = 2.54 + random(i + 900) * 0.15
    const ray = new T.Line(
      new T.BufferGeometry().setFromPoints([
        new T.Vector3(Math.cos(angle) * r, Math.sin(angle) * r, -0.1),
        new T.Vector3(
          Math.cos(angle) * (r + random(i + 1) * 0.3),
          Math.sin(angle) * (r + random(i + 1) * 0.3),
          -0.1,
        ),
      ]),
      new T.LineBasicMaterial({ color: '#2477B9', transparent: true, opacity: 0.25 }),
    )
    corona.add(ray)
    if (i % 5 === 0) {
      const particle = cube(0.015, palette.blue, true)
      particle.position.copy(
        ray.geometry.attributes.position
          ? new T.Vector3().fromBufferAttribute(ray.geometry.getAttribute('position'), 1)
          : new T.Vector3(),
      )
      corona.add(particle)
    }
  }
  group.add(corona)
  const halo = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
  })
  halo.colorNode = color('#2477B9')
  halo.opacityNode = float(1).sub(uv().sub(0.5).length().mul(2)).max(0).pow(2.6).mul(0.5)
  const glow = new T.Mesh(new T.PlaneGeometry(11, 11), halo)
  glow.position.z = -0.4
  glow.raycast = () => {}
  group.add(glow)
  return group
}

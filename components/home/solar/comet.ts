import * as T from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { color, float, uv } from 'three/tsl'
import { cube, palette } from './terrain'

const DUST = 18
const LENGTH = 1.9
const AXIS = new T.Vector3(1, 0, 0)
const FLAT = new T.Quaternion().setFromAxisAngle(AXIS, -Math.PI / 2)

export function makeComet() {
  const comet = new T.Group()
  const head = cube(0.07, palette.blue, true)
  head.material.emissiveIntensity = 2.6
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: T.DoubleSide,
    blending: T.AdditiveBlending,
  })
  const across = uv().y.sub(0.5).mul(2)
  material.colorNode = color(palette.blue).mul(1.4)
  material.opacityNode = float(1)
    .sub(uv().x)
    .pow(2.4)
    .mul(float(1).sub(across.mul(across)))
    .mul(0.5)
  const tail = new T.Mesh(new T.PlaneGeometry(1, 1), material)
  tail.name = 'tail'
  comet.add(head, tail)
  for (let i = 0; i < DUST; i++) {
    const dust = cube(0.02, palette.blue, true)
    dust.name = 'dust'
    comet.add(dust)
  }
  return comet
}

export function updateComet(comet: T.Object3D, head: T.Vector3, seconds: number) {
  comet.position.copy(head)
  const away = head.clone().setY(0).normalize()
  const side = new T.Vector3(-away.z, 0, away.x)
  const tail = comet.getObjectByName('tail')!
  tail.position.copy(away).multiplyScalar(LENGTH / 2)
  tail.quaternion.setFromUnitVectors(AXIS, away).multiply(FLAT)
  tail.scale.set(LENGTH, 0.24, 1)
  let index = 0
  for (const dust of comet.children) {
    if (dust.name !== 'dust') continue
    const t = (index / DUST + seconds * 0.11) % 1
    dust.position
      .copy(away)
      .multiplyScalar(t * LENGTH)
      .addScaledVector(side, Math.sin(index * 1.7 + seconds * 0.6) * 0.09 * t)
    dust.position.y = Math.sin(index * 2.3) * 0.03 * t
    dust.scale.setScalar(1 - t * 0.85)
    index++
  }
}

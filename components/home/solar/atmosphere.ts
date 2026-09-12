import { Mesh, SphereGeometry, Color, DoubleSide } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  abs,
  color,
  dot,
  float,
  mx_noise_float,
  normalView,
  normalWorld,
  positionViewDirection,
  positionWorld,
  uniform,
  uv,
  vec3,
} from 'three/tsl'

export function atmosphere(accent: string) {
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
  material.colorNode = color(new Color(accent).lerp(new Color('#9BCAEB'), 0.38))
  material.opacityNode = float(1)
    .sub(abs(dot(normalView, positionViewDirection)))
    .pow(4)
    .mul(dot(normalWorld, positionWorld.negate().normalize()).add(0.12).max(0))
    .mul(0.72)
  return new Mesh(new SphereGeometry(1.025, 96, 64), material)
}
export function convection() {
  const phase = uniform(0)
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  })
  const field = mx_noise_float(vec3(uv().mul(65), phase))
    .mul(0.5)
    .add(0.5)
  material.colorNode = color('#2477B9').mul(field.mul(0.6).add(0.4))
  material.opacityNode = field.pow(4).mul(0.22)
  const mesh = new Mesh(new SphereGeometry(2.45, 96, 64), material)
  mesh.scale.z = 0.085
  mesh.position.z = -0.2
  mesh.name = 'convection'
  return { mesh, phase }
}

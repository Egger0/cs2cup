import * as T from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { color, float, mx_noise_float, positionLocal } from 'three/tsl'

export function orbitalDust() {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: T.DoubleSide,
  })
  const radius = positionLocal.xy.length()
  const density = mx_noise_float(positionLocal.mul(0.7)).mul(0.5).add(0.5)
  const filaments = mx_noise_float(positionLocal.mul(3.5)).mul(0.5).add(0.5)
  const inner = radius.sub(3).div(3).clamp(0, 1)
  const outer = float(1).sub(radius.div(17)).max(0)
  material.colorNode = color('#668496')
  material.opacityNode = density.pow(2).mul(filaments).mul(inner).mul(outer).mul(0.22)
  const dust = new T.Mesh(new T.PlaneGeometry(36, 36), material)
  dust.rotation.x = -Math.PI / 2
  dust.position.y = -0.18
  return dust
}

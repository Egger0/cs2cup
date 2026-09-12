import type * as T from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import {
  float,
  mx_fractal_noise_float,
  normalView,
  positionLocal,
  positionView,
  smoothstep,
} from 'three/tsl'
import type { PlanetMaps } from './planet-maps'

const DETAIL = 40

export function surfaceMaterial(source: T.MeshStandardMaterial, maps: PlanetMaps) {
  const material = new MeshStandardNodeMaterial({
    vertexColors: true,
    metalness: source.metalness,
    flatShading: source.flatShading,
  })
  material.colorNode = maps.albedo.rgb
  material.roughnessNode = maps.roughness.g.mul(source.roughness)
  if (source.flatShading) return material
  const footprint = positionLocal
    .dFdx()
    .length()
    .add(positionLocal.dFdy().length())
    .mul(DETAIL * 4)
  const micro = mx_fractal_noise_float(positionLocal.mul(DETAIL), 3, 2.1, 0.5)
    .mul(0.002)
    .mul(float(1).sub(smoothstep(0.1, 0.5, footprint)))
  const height = maps.relief.r.mul(0.018).add(micro)
  const dpdx = positionView.dFdx()
  const dpdy = positionView.dFdy()
  const r1 = dpdy.cross(normalView)
  const r2 = normalView.cross(dpdx)
  const determinant = dpdx.dot(r1)
  const gradient = determinant.sign().mul(height.dFdx().mul(r1).add(height.dFdy().mul(r2)))
  material.normalNode = determinant.abs().mul(normalView).sub(gradient).normalize()
  return material
}

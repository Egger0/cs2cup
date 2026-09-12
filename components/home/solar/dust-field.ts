import * as T from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { color, positionView, smoothstep } from 'three/tsl'
import { random } from './terrain'

const APPROACH = new T.Vector3(0, 20, 28).normalize()

export function dustField(count = 720) {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
  })
  material.colorNode = color('#cfe3f2')
  material.opacityNode = smoothstep(2, 7, positionView.z.negate()).mul(0.55)
  const mesh = new T.InstancedMesh(new T.IcosahedronGeometry(1, 0), material, count)
  const side = new T.Vector3(1, 0, 0)
  const up = new T.Vector3().crossVectors(APPROACH, side).normalize()
  const matrix = new T.Matrix4()
  const rotation = new T.Quaternion()
  const position = new T.Vector3()
  const scale = new T.Vector3()
  for (let i = 0; i < count; i++) {
    const along = 1.25 + random(i * 5 + 1) * 5.6
    const angle = random(i * 5 + 2) * Math.PI * 2
    const radius = 0.06 + random(i * 5 + 3) ** 0.7 * 0.5
    position
      .copy(APPROACH)
      .multiplyScalar(along)
      .addScaledVector(side, Math.cos(angle) * radius)
      .addScaledVector(up, Math.sin(angle) * radius)
    scale.setScalar(0.0008 + random(i * 5 + 4) ** 3 * 0.0026)
    matrix.compose(position, rotation, scale)
    mesh.setMatrixAt(i, matrix)
  }
  mesh.name = 'dust-field'
  mesh.frustumCulled = false
  mesh.raycast = () => {}
  return mesh
}

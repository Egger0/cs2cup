import * as T from 'three'
import { CubeRenderTarget, MeshBasicNodeMaterial, type WebGPURenderer } from 'three/webgpu'
import {
  abs,
  cameraPosition,
  color,
  cubeTexture,
  dot,
  float,
  hash,
  instanceIndex,
  max,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  normalWorld,
  normalize,
  positionLocal,
  positionWorld,
  smoothstep,
  time,
  uv,
  vec2,
  vec3,
} from 'three/tsl'
import { random } from './terrain'

const RADIUS = 600
const AXIS = new T.Vector3(0.28, 0.86, -0.42).normalize()
const GALAXY = vec3(AXIS.x, AXIS.y, AXIS.z)
const LIGHT = vec3(-0.55, 0.78, 0.3).normalize()
const tone = (hex: string) => vec3(...new T.Color(hex).toArray())

export function createSky() {
  const scene = new T.Scene()
  const camera = new T.PerspectiveCamera(48, 1, 1, RADIUS * 2)
  const target = new CubeRenderTarget(1024, { type: T.HalfFloatType })
  const baked = new MeshBasicNodeMaterial({ side: T.BackSide, depthWrite: false })
  baked.colorNode = cubeTexture(target.texture, normalize(positionLocal))
  const drift = new T.Group()
  drift.add(new T.Mesh(new T.SphereGeometry(RADIUS, 64, 32), baked), stars())
  scene.add(drift)
  return {
    scene,
    camera,
    bake(renderer: WebGPURenderer) {
      const source = new T.Scene()
      source.add(
        dome(),
        planet(new T.Vector3(0.12, -0.99, -0.09), 400, 30),
        galaxy(new T.Vector3(0.15, -0.28, -0.95), 480),
      )
      new T.CubeCamera(1, RADIUS * 2, target).update(renderer, source)
      source.traverse(object => {
        if (object instanceof T.Mesh) {
          object.geometry.dispose()
          ;(object.material as T.Material).dispose()
        }
      })
    },
    dispose: () => target.dispose(),
    update(main: T.Camera, zoom: number, seconds: number, aspect: number) {
      camera.quaternion.copy(main.quaternion)
      camera.fov = 48 / (1 + (zoom - 1) * 0.035)
      camera.aspect = aspect
      camera.updateProjectionMatrix()
      drift.rotation.y = seconds * 0.0012
    },
  }
}

function dome() {
  const material = new MeshBasicNodeMaterial({ side: T.BackSide, depthWrite: false })
  const direction = normalize(positionLocal)
  const band = float(1)
    .sub(abs(dot(direction, GALAXY)).mul(2.4))
    .max(0)
  const cloud = mx_fractal_noise_float(direction.mul(2.2), 5, 2.1, 0.55).mul(0.5).add(0.5)
  const fine = mx_fractal_noise_float(direction.mul(8.5), 4, 2, 0.5).mul(0.5).add(0.5)
  const lanes = smoothstep(
    0.02,
    0.22,
    abs(mx_noise_float(direction.mul(5.5).add(vec3(3.1, 0.4, 1.7)))),
  )
  const glow = band.pow(2).mul(cloud).mul(fine.mul(0.6).add(0.4)).mul(lanes.mul(0.65).add(0.35))
  const bulge = smoothstep(0.6, 1, dot(direction, vec3(0.62, -0.18, -0.76).normalize())).mul(band)
  const veil = mx_fractal_noise_float(direction.mul(1.4).add(vec3(7, 2, 5)), 4, 2, 0.5)
    .max(0)
    .pow(2)
  material.colorNode = tone('#0a0c0e')
    .add(tone('#1c3342').mul(glow.mul(0.6)))
    .add(tone('#3f7482').mul(glow.pow(2).mul(0.3)))
    .add(tone('#6a5140').mul(bulge.mul(glow).mul(0.45)))
    .add(tone('#12303a').mul(veil.mul(0.4)))
  return new T.Mesh(new T.SphereGeometry(RADIUS, 96, 48), material)
}

function stars() {
  const count = 5200
  const seed = hash(instanceIndex)
  const twinkle = time.mul(seed.mul(2.2).add(0.4)).add(seed.mul(40)).sin().mul(0.18).add(0.82)
  const layer = () =>
    new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
      blending: T.AdditiveBlending,
    })
  const material = layer()
  material.opacityNode = twinkle.mul(float(1).sub(uv().sub(0.5).length().mul(2)).max(0).pow(1.8))
  const flare = layer()
  const across = abs(uv().sub(0.5).mul(2))
  flare.opacityNode = max(
    across.x.mul(-26).exp().mul(across.y.mul(-3.2).exp()),
    across.y.mul(-26).exp().mul(across.x.mul(-3.2).exp()),
  )
    .mul(twinkle)
    .mul(0.45)
  const points = new T.InstancedMesh(new T.PlaneGeometry(1, 1), material, count)
  const bright: [T.Matrix4, T.Color][] = []
  const matrix = new T.Matrix4()
  const rotation = new T.Quaternion()
  const origin = new T.Vector3()
  const up = new T.Vector3(0, 1, 0)
  for (let i = 0; i < count; i++) {
    const z = random(i * 3 + 1) * 2 - 1
    const a = random(i * 3 + 2) * Math.PI * 2
    const ring = Math.sqrt(1 - z * z)
    const direction = new T.Vector3(ring * Math.cos(a), z, ring * Math.sin(a))
    if (random(i * 3 + 3) < 0.5)
      direction
        .projectOnPlane(AXIS)
        .normalize()
        .addScaledVector(AXIS, (random(i + 91) - 0.5) * 0.3)
        .normalize()
    const position = direction.multiplyScalar(RADIUS * 0.92)
    rotation.setFromRotationMatrix(matrix.lookAt(position, origin, up))
    const magnitude = random(i * 7 + 5) ** 6
    matrix.compose(position, rotation, new T.Vector3().setScalar(0.9 + magnitude * 3.6))
    points.setMatrixAt(i, matrix)
    const kind = random(i * 11 + 7)
    const tint = new T.Color(kind < 0.12 ? '#ffd7a6' : kind < 0.6 ? '#e3ecf4' : '#a8c6ea')
    tint.multiplyScalar(0.3 + magnitude * 1.8)
    points.setColorAt(i, tint)
    if (magnitude > 0.42 && bright.length < 60)
      bright.push([matrix.clone().scale(new T.Vector3(7, 7, 7)), tint])
  }
  const flares = new T.InstancedMesh(new T.PlaneGeometry(1, 1), flare, bright.length)
  bright.forEach(([placement, tint], index) => {
    flares.setMatrixAt(index, placement)
    flares.setColorAt(index, tint)
  })
  points.frustumCulled = false
  flares.frustumCulled = false
  return new T.Group().add(points, flares)
}

function planet(direction: T.Vector3, distance: number, degrees: number) {
  const radius = distance * Math.sin(T.MathUtils.degToRad(degrees))
  const material = new MeshBasicNodeMaterial()
  const lit = smoothstep(-0.12, 0.55, dot(normalWorld, LIGHT))
  const point = normalize(positionLocal)
  const swirl = mx_fractal_noise_float(point.mul(vec3(3, 12, 3)), 4, 2, 0.5)
  const bands = point.y.mul(18).add(swirl.mul(2.2)).sin().mul(0.5).add(0.5)
  const view = normalize(cameraPosition.sub(positionWorld))
  const edge = float(1).sub(dot(normalWorld, view).max(0)).pow(3)
  material.colorNode = mix(tone('#162129'), tone('#34474f'), bands)
    .mul(lit.mul(0.3).add(0.03))
    .add(tone('#4f93a8').mul(edge.mul(lit.add(0.05)).mul(0.32)))
  const mesh = new T.Mesh(new T.SphereGeometry(radius, 128, 64), material)
  mesh.position.copy(direction.normalize()).multiplyScalar(distance)
  mesh.rotation.z = 0.35
  return mesh
}

function galaxy(direction: T.Vector3, distance: number) {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
  })
  const disc = uv().sub(0.5).mul(vec2(2, 5))
  const core = float(1).sub(disc.length()).max(0).pow(3)
  const arms = mx_fractal_noise_float(vec3(disc.mul(3), 1.7), 3, 2, 0.5)
    .mul(0.5)
    .add(0.5)
  material.colorNode = color('#a9c4d6')
  material.opacityNode = core.mul(arms.mul(0.6).add(0.4)).mul(0.5)
  const mesh = new T.Mesh(new T.PlaneGeometry(50, 50), material)
  mesh.position.copy(direction.normalize()).multiplyScalar(distance)
  mesh.lookAt(0, 0, 0)
  mesh.rotateZ(0.6)
  return mesh
}

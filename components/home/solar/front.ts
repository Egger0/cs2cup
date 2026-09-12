import * as T from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { PLANET_COLORS } from '@/lib/planets'
import type { Backend } from './hardware'

const ZONES: Record<string, string> = {
  overview: '#9bcaeb',
  club: '#f1efe8',
  statement: '#9bcaeb',
  wall: '#d6e1e6',
  clubhouse: '#9bcaeb',
  route: '#d4ab5c',
}
const metal = (color: string, roughness = 0.3) =>
  new T.MeshStandardMaterial({
    color,
    metalness: 0.72,
    roughness,
    emissive: color,
    emissiveIntensity: 0.08,
  })

function trophy(material: T.Material) {
  const cup = new T.Group()
  const profile = [
    [0, 0],
    [0.55, 0],
    [0.55, 0.09],
    [0.22, 0.16],
    [0.1, 0.22],
    [0.1, 0.5],
    [0.2, 0.58],
    [0.52, 0.74],
    [0.62, 1],
    [0.65, 1.08],
    [0.58, 1.08],
    [0.5, 0.8],
    [0.14, 0.66],
    [0, 0.64],
  ].map(([x, y]) => new T.Vector2(x, y))
  cup.add(new T.Mesh(new T.LatheGeometry(profile, 48), material))
  for (const side of [-1, 1]) {
    const handle = new T.Mesh(new T.TorusGeometry(0.2, 0.045, 12, 32, Math.PI), material)
    handle.position.set(side * 0.58, 0.84, 0)
    handle.rotation.z = (side * -Math.PI) / 2
    cup.add(handle)
  }
  cup.children.forEach(child => (child.position.y -= 0.55))
  return cup
}
function headset(material: T.Material) {
  const group = new T.Group()
  group.add(new T.Mesh(new T.TorusGeometry(0.55, 0.08, 12, 48, Math.PI), material))
  const pad = metal('#8c9aa0', 0.45)
  for (const side of [-1, 1]) {
    const cup = new T.Mesh(new T.CylinderGeometry(0.22, 0.22, 0.16, 32), pad)
    cup.rotation.z = Math.PI / 2
    cup.position.set(side * 0.55, -0.02, 0)
    group.add(cup)
  }
  return group
}
function medal(material: T.Material) {
  const group = new T.Group()
  const disc = new T.Mesh(new T.CylinderGeometry(0.4, 0.4, 0.07, 48), material)
  disc.rotation.x = Math.PI / 2
  group.add(disc, new T.Mesh(new T.TorusGeometry(0.4, 0.035, 10, 48), material))
  return group
}
const keycap = (material: T.Material) =>
  new T.Mesh(new RoundedBoxGeometry(0.62, 0.36, 0.62, 4, 0.12), material)
function mouse(material: T.Material) {
  const shell = new T.Mesh(new T.CapsuleGeometry(0.3, 0.44, 8, 24), material)
  shell.scale.set(1, 1, 0.55)
  return shell
}

const PROPS: [(material: T.Material) => T.Object3D, string, number, number, number][] = [
  [trophy, '#d4ab5c', 0.82, 0.3, 1],
  [keycap, '#9bcaeb', 0.98, 1.4, -1],
  [mouse, '#f1efe8', 0.74, 2.6, 1],
  [headset, '#b28a51', 1.06, 3.6, -1],
  [keycap, '#d94b58', 0.86, 4.5, 1],
  [medal, '#c9d4d8', 0.95, 5.4, -1],
  [keycap, '#8b9365', 0.78, 6.1, 1],
]

export async function startFront(host: HTMLElement, backend: Backend, signal: AbortSignal) {
  const renderer = new WebGPURenderer({
    antialias: true,
    alpha: true,
    forceWebGL: backend === 'webgl',
  })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.outputColorSpace = T.SRGBColorSpace
  renderer.toneMapping = T.ACESFilmicToneMapping
  renderer.setClearColor('#000000', 0)
  await renderer.init()
  if (signal.aborted) {
    renderer.dispose()
    return null
  }
  const scene = new T.Scene()
  const camera = new T.PerspectiveCamera(28, 1, 0.1, 60)
  camera.position.set(0, 0, 10)
  const key = new T.DirectionalLight('#ffffff', 2.6)
  key.position.set(-3, 4, 6)
  const rim = new T.DirectionalLight('#9bcaeb', 1.8)
  rim.position.set(4, -1, -3)
  scene.add(new T.HemisphereLight('#dfe9ff', '#0c1014', 1.6), key, rim)
  const tint = metal('#9bcaeb', 0.26)
  const companion = trophy(tint)
  scene.add(companion)
  const props = PROPS.map(([make, color, radius, angle, direction], index) => {
    const object = make(metal(color, 0.34))
    object.visible = false
    scene.add(object)
    return { object, radius, angle, direction, index }
  })
  if (backend === 'webgpu') await renderer.compileAsync(scene, camera).catch(() => {})
  if (signal.aborted) {
    renderer.dispose()
    return null
  }
  const canvas = renderer.domElement
  canvas.setAttribute('aria-hidden', 'true')
  host.append(canvas)
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const animated = () =>
    !reduced.matches && document.documentElement.dataset.homeEffects !== 'paused'
  const root = document.documentElement
  const colorTarget = new T.Color('#9bcaeb')
  let spin = 0
  let spinTarget = 0
  let tilt = 0
  let tiltTarget = 0
  let route = 0
  let current = 'overview'
  let routeVisible = false
  let presence = 0
  let drop = 1
  let frame = 0
  let scrollFrame = 0
  let last = performance.now()
  let lastScroll = window.scrollY
  let half = 1
  let aspect = 1
  let unit = 1
  const zone = () => {
    const middle = window.innerHeight / 2
    for (const node of document.body.querySelectorAll<HTMLElement>(
      '[data-solar-chapter], [data-zone]',
    )) {
      const box = node.getBoundingClientRect()
      if (box.top <= middle && box.bottom > middle)
        return node.dataset.solarChapter ?? node.dataset.zone ?? 'overview'
    }
    return 'clubhouse'
  }
  const read = () => {
    scrollFrame = 0
    const y = window.scrollY
    spinTarget = y * 0.0042
    tiltTarget = T.MathUtils.clamp((y - lastScroll) * 0.012, -0.5, 0.5)
    lastScroll = y
    const key = zone()
    current = key
    colorTarget.set(ZONES[key] ?? PLANET_COLORS.get(key) ?? '#9bcaeb')
    const section = document.getElementById('route')
    if (section) {
      const box = section.getBoundingClientRect()
      routeVisible = box.top < window.innerHeight && box.bottom > 0
      route = T.MathUtils.clamp(-box.top / Math.max(1, box.height - window.innerHeight), 0, 1)
    }
    invalidate()
  }
  const schedule = () => {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(read)
  }
  const draw = (now: number) => {
    frame = 0
    if (document.hidden) return
    const moving = animated()
    const dt = Math.min((now - last) / 1000, 0.05)
    last = now
    const ease = moving ? 1 - Math.exp(-6 * dt) : 1
    const arrived = root.dataset.homeEntry !== 'intro' || root.dataset.solarArrived === ''
    const shown =
      arrived && current !== 'overview' && !(current === 'route' && window.innerWidth < 700) ? 1 : 0
    presence += (shown - presence) * (moving ? 1 - Math.exp(-4 * dt) : 1)
    drop += (1 - shown - drop) * (moving ? 1 - Math.exp(-2.6 * dt) : 1)
    spin += ((moving ? spinTarget : 0.6) - spin) * ease
    tilt += ((moving ? tiltTarget : 0) - tilt) * ease
    tiltTarget *= moving ? Math.exp(-5 * dt) : 0
    tint.color.lerp(colorTarget, ease)
    tint.emissive.copy(tint.color)
    const size = (window.innerWidth < 700 ? 50 : 64) * unit
    companion.scale.setScalar((size / 1.1) * presence)
    companion.position.set(
      half * aspect - (window.innerWidth < 700 ? 44 : 64) * unit,
      -half + 150 * unit + drop * drop * half * 1.6,
      0,
    )
    companion.rotation.set(0.28 + tilt, spin, tilt * 0.4)
    const envelope =
      T.MathUtils.smoothstep(route, 0, 0.08) * (1 - T.MathUtils.smoothstep(route, 0.94, 1))
    for (const prop of props) {
      prop.object.visible = moving && routeVisible && envelope > 0.01
      if (!prop.object.visible) continue
      const angle = prop.angle + route * Math.PI * 1.6 * prop.direction
      const depth = Math.sin(angle * 2 + prop.index) * 1.6
      prop.object.position.set(
        Math.cos(angle) * prop.radius * half * Math.min(aspect, 1.5),
        Math.sin(angle) * prop.radius * half * 0.6 * Math.min(1, aspect * 1.2) +
          half * (aspect < 1 ? 0.14 : 0.06),
        depth,
      )
      prop.object.scale.setScalar(
        half * 0.24 * Math.min(1, aspect * 1.3) * envelope * (1 + depth * 0.08),
      )
      prop.object.rotation.set(route * 5 + prop.index, route * 7 * prop.direction, route * 3)
    }
    renderer.render(scene, camera)
    const settled =
      Math.abs(spinTarget - spin) < 1e-3 &&
      Math.abs(tilt) < 1e-3 &&
      Math.abs(presence - shown) < 1e-3 &&
      Math.abs(drop - (1 - shown)) < 1e-3 &&
      Math.abs(tint.color.r - colorTarget.r) +
        Math.abs(tint.color.g - colorTarget.g) +
        Math.abs(tint.color.b - colorTarget.b) <
        3e-3
    if (moving && !settled) frame = requestAnimationFrame(draw)
  }
  function invalidate() {
    if (!frame && !document.hidden) frame = requestAnimationFrame(draw)
  }
  const resize = () => {
    aspect = window.innerWidth / window.innerHeight
    camera.aspect = aspect
    camera.updateProjectionMatrix()
    half = 10 * Math.tan(T.MathUtils.degToRad(camera.fov / 2))
    unit = (half * 2) / window.innerHeight
    renderer.setPixelRatio(
      Math.max(
        1,
        Math.min(
          devicePixelRatio,
          1.5,
          Math.sqrt(2.2e6 / Math.max(1, window.innerWidth * window.innerHeight)),
        ),
      ),
    )
    renderer.setSize(window.innerWidth, window.innerHeight)
    read()
  }
  const observer = new MutationObserver(invalidate)
  observer.observe(root, {
    attributes: true,
    attributeFilter: ['data-solar-arrived', 'data-home-effects'],
  })
  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', resize)
  document.addEventListener('visibilitychange', invalidate)
  reduced.addEventListener('change', invalidate)
  resize()
  return {
    destroy() {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(scrollFrame)
      observer.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', invalidate)
      reduced.removeEventListener('change', invalidate)
      scene.traverse(object => {
        if (object instanceof T.Mesh) {
          object.geometry.dispose()
          ;(object.material as T.Material).dispose()
        }
      })
      renderer.dispose()
      canvas.remove()
    },
  }
}

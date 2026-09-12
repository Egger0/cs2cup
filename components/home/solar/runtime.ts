import * as T from 'three'
import { RenderPipeline, WebGPURenderer } from 'three/webgpu'
import { pass } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { solarEase } from './easing'
import { buildSystem, type SolarData } from './system'
import { createSky } from './sky'
import { createFlight, updateOrbits, type FlightState } from './flight'
import { createLabels } from './labels'
import { bindInteraction } from './interaction'
import type { Backend } from './hardware'

const PIXELS = 2.8e6
const budget = (width: number, height: number) =>
  Math.max(1, Math.min(devicePixelRatio, 2, Math.sqrt(PIXELS / Math.max(1, width * height))))

export async function startSolar(
  host: HTMLElement,
  data: SolarData,
  backend: Backend,
  select: (key: string | null) => void,
  zoom: (level: number) => void,
  signal: AbortSignal,
  fail: () => void,
) {
  const renderer = new WebGPURenderer({ antialias: true, forceWebGL: backend === 'webgl' })
  renderer.outputColorSpace = T.SRGBColorSpace
  renderer.toneMapping = T.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.9
  renderer.setClearColor('#000000', 0)
  const system = await buildSystem(data)
  const sky = createSky()
  const dispose = () => {
    const geometries = new Set<T.BufferGeometry>()
    const materials = new Set<T.Material>()
    for (const scene of [system.scene, sky.scene])
      scene.traverse(object => {
        if (object instanceof T.Mesh || object instanceof T.Line || object instanceof T.Points) {
          geometries.add(object.geometry)
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            materials.add(material)
        }
      })
    geometries.forEach(geometry => geometry.dispose())
    materials.forEach(material => material.dispose())
    system.maps.forEach(maps => maps.dispose())
    sky.dispose()
    renderer.dispose()
    renderer.domElement.remove()
  }
  try {
    await renderer.init()
  } catch (error) {
    dispose()
    throw error
  }
  if (signal.aborted) {
    dispose()
    return null
  }
  sky.bake(renderer)
  const camera = new T.PerspectiveCamera(30, 1, 0.05, 600)
  const pipeline = new RenderPipeline(renderer)
  const color = pass(system.scene, camera).getTextureNode('output')
  const backdrop = pass(sky.scene, sky.camera).getTextureNode('output')
  const glow = bloom(color, 0.65, 0.42, 0.85)
  glow.setResolutionScale(0.4)
  pipeline.outputNode = backdrop.mul(color.a.oneMinus()).add(color).add(glow)
  if (backend === 'webgpu')
    await Promise.all([
      renderer.compileAsync(system.scene, camera),
      renderer.compileAsync(sky.scene, sky.camera),
    ]).catch(() => {})
  if (signal.aborted) {
    dispose()
    return null
  }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const animated = () =>
    !reduced.matches && document.documentElement.dataset.homeEffects !== 'paused'
  const late = performance.now() > 2200
  const entryDuration = late ? 1.6 : 2.6
  const state: FlightState = {
    selected: null,
    hovered: null,
    level: 0,
    pointer: new T.Vector2(),
    dragging: false,
    spin: new T.Vector2(),
    velocity: new T.Vector2(),
    base: 40,
    distance: 40,
    entry: document.documentElement.dataset.homeEntry === 'intro' && animated() ? 0 : 1,
    entryFrom: late ? 2.6 : 6.5,
    chapter: 'near',
    path: { value: 0, keys: ['overview'] },
  }
  const flight = createFlight(system, camera, state)
  const labels = createLabels([...document.querySelectorAll<HTMLElement>('[data-solar-anchor]')])
  const canvas = renderer.domElement
  canvas.setAttribute('aria-hidden', 'true')
  canvas.dataset.solarCanvas = ''
  host.prepend(canvas)
  let frame = 0
  let disposed = false
  let looping = false
  let rendered = performance.now()
  let activeUntil = 0
  let seconds = 0
  let renderCount = 0
  let checks = 0
  let settled = false
  let promoted = false
  let width = 1
  let height = 1
  let scale = 1
  let ratio = 0
  let samples: number[] = []
  const wake = () => {
    activeUntil = performance.now() + 1600
  }
  const applyRatio = () => {
    const next = Math.max(0.6, budget(width, height) * scale)
    if (Math.abs(next - ratio) < 0.01) return
    ratio = next
    renderer.setPixelRatio(ratio)
  }
  const adapt = (elapsed: number) => {
    samples.push(elapsed)
    if (samples.length < 24) return
    const sorted = [...samples].sort((a, b) => a - b)
    const floor = sorted[Math.floor(sorted.length * 0.1)]!
    const middle = sorted[Math.floor(sorted.length * 0.5)]!
    const misses = samples.filter(value => value > floor * 1.6).length / samples.length
    samples = []
    checks++
    if ((misses > 0.15 || middle > 20) && scale > 0.5) {
      scale = Math.max(0.5, scale - 0.15)
      applyRatio()
    } else if (middle > 50 && checks <= 3) fail()
  }
  const draw = (now: number) => {
    frame = 0
    if (disposed || document.hidden) {
      looping = false
      return
    }
    const moving = animated()
    const active = state.entry < 1 || now < activeUntil || state.chapter === 'near'
    if (moving && looping && now - rendered < (active ? 1000 / 60 : 1000 / 30) - 2) {
      frame = requestAnimationFrame(draw)
      return
    }
    const elapsed = now - rendered
    const delta = Math.min(elapsed / 1000, 0.05)
    rendered = now
    if (moving && looping && active && state.entry >= 1 && state.chapter === 'near') adapt(elapsed)
    if (moving) seconds += delta
    if (state.entry < 1) state.entry = moving ? Math.min(1, state.entry + delta / entryDuration) : 1
    if (state.entry > 0.8) document.documentElement.dataset.solarArrived = ''
    if (!promoted && state.path.value > 0.6) {
      promoted = true
      const thrifty =
        window.innerWidth < 700 ||
        Boolean((navigator as { connection?: { saveData?: boolean } }).connection?.saveData)
      if (!thrifty) {
        const queue = [...system.maps.values()]
        const step = () => {
          const maps = queue.shift()
          if (!maps || disposed) return
          void maps.promote().then(() => {
            invalidate()
            window.setTimeout(step, 220)
          }, step)
        }
        step()
      }
    }
    system.dust.visible = state.entry < 1
    const opening = T.MathUtils.clamp((state.entry - 0.5) / 0.45, 0, 1)
    system.plasma.phase.value = (seconds * 0.012) % 1000
    updateOrbits(system, state, seconds, solarEase(opening), moving ? delta : 1)
    settled = !flight(moving ? delta : 1, moving, seconds)
    system.scene.updateMatrixWorld(true)
    camera.updateMatrixWorld(true)
    labels.place(width, height, system, camera, state)
    sky.update(camera, state.base / Math.max(0.001, state.distance), seconds, camera.aspect)
    pipeline.render()
    host.dataset.solarReady = 'true'
    host.dataset.renderCount = String(++renderCount)
    looping = moving && !(state.chapter === 'far' && settled)
    if (looping) frame = requestAnimationFrame(draw)
  }
  const invalidate = () => {
    if (!disposed && !frame && !document.hidden) frame = requestAnimationFrame(draw)
  }
  const poke = () => {
    wake()
    invalidate()
  }
  const resize = () => {
    width = host.clientWidth
    height = host.clientHeight
    camera.aspect = width / height
    const halfWidth = Math.max(15, 7 + data.games.length * 3.2) * (camera.aspect < 1 ? 1.18 : 1)
    state.base = halfWidth / (camera.aspect * Math.tan(T.MathUtils.degToRad(camera.fov / 2)))
    camera.far = state.base * 12
    if (camera.aspect < 0.8) camera.setViewOffset(width, height, 0, height * 0.06, width, height)
    else camera.clearViewOffset()
    camera.updateProjectionMatrix()
    system.dust.scale.setScalar(state.base)
    applyRatio()
    renderer.setSize(width, height)
    poke()
  }
  const synchronize = () => {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    looping = false
    rendered = performance.now()
    poke()
  }
  const motion = new MutationObserver(synchronize)
  motion.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-home-effects'],
  })
  const size = new ResizeObserver(resize)
  size.observe(host)
  document.addEventListener('visibilitychange', synchronize)
  reduced.addEventListener('change', synchronize)
  const unbind = bindInteraction(canvas, camera, system, state, select, zoom, poke)
  const surrender = () => {
    if (!disposed) fail()
  }
  const contextLost = (event: Event) => {
    event.preventDefault()
    surrender()
  }
  canvas.addEventListener('webglcontextlost', contextLost)
  void (renderer.backend as { device?: { lost?: Promise<unknown> } }).device?.lost?.then(
    surrender,
    () => {},
  )
  const upgrade = (key: string | null, depth: number) => {
    const body = system.bodies.find(item => item.key === key)
    const planet = body?.parent ?? body
    system.maps
      .get(planet?.key ?? '')
      ?.upgrade(depth)
      .then(invalidate, () => {})
  }
  resize()
  return {
    focus(key: string | null) {
      state.selected = key
      state.spin.set(0, 0)
      state.velocity.set(0, 0)
      upgrade(key, 0)
      poke()
    },
    hover(key: string | null) {
      state.hovered = key
      upgrade(key, 0)
      poke()
    },
    zoom(level: number) {
      state.level = level
      upgrade(state.selected, level)
      poke()
    },
    progress(value: number, keys: string[]) {
      state.path = { value, keys }
      state.chapter = keys.at(-1) === 'far' && value > keys.length - 1.5 ? 'far' : 'near'
      poke()
    },
    skipEntry() {
      state.entry = 1
      poke()
    },
    destroy() {
      disposed = true
      cancelAnimationFrame(frame)
      motion.disconnect()
      size.disconnect()
      document.removeEventListener('visibilitychange', synchronize)
      reduced.removeEventListener('change', synchronize)
      canvas.removeEventListener('webglcontextlost', contextLost)
      unbind()
      labels.dispose()
      dispose()
      delete host.dataset.solarReady
      delete host.dataset.renderCount
      delete document.documentElement.dataset.solarArrived
    },
  }
}
export type SolarRuntime = NonNullable<Awaited<ReturnType<typeof startSolar>>>

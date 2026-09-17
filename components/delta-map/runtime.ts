import * as T from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { ICON_ATLAS, type DeltaMapData, type SandKind, type SandPoint } from '@/lib/delta-sand'
import type { Backend } from '@/components/home/solar/hardware'
import { createAdaptation } from '@/components/home/solar/adapt'
import { loadImagery } from './plate'
import { createContent } from './content'
import { createLighting } from './lighting'
import { bindOrbit, createOrbit } from './orbit'
import { placeAnchors } from './anchors'
import { setAtlas } from './markers'

export interface SandCallbacks {
  hover: (point: SandPoint | null) => void
  select: (point: SandPoint | null) => void
  ground: (x: number, y: number) => void
  ready: () => void
  fail: () => void
}

const ease = (value: number) => 1 - Math.pow(1 - value, 3)

export async function startSandTable(
  host: HTMLElement,
  overlay: HTMLElement,
  backend: Backend,
  callbacks: SandCallbacks,
  signal: AbortSignal,
) {
  const renderer = new WebGPURenderer({
    antialias: true,
    alpha: true,
    forceWebGL: backend === 'webgl',
  })
  renderer.outputColorSpace = T.SRGBColorSpace
  renderer.toneMapping = T.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15
  renderer.setClearColor('#000000', 0)
  await renderer.init()
  if (signal.aborted) {
    renderer.dispose()
    return null
  }
  const scene = new T.Scene()
  const light = createLighting(scene)
  const world = new T.Group()
  scene.add(world)
  const camera = new T.PerspectiveCamera(34, 1, 0.02, 40)
  const orbit = createOrbit(camera)
  const canvas = renderer.domElement
  canvas.setAttribute('aria-hidden', 'true')
  host.prepend(canvas)
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const raycaster = new T.Raycaster()
  let rise = 1
  let frame = 0
  let last = performance.now()
  let width = 1
  let height = 1
  let disposed = false
  let announced = false
  let showing = 0
  let inside: number | null = null
  let inset = 0
  let level: string | null = null
  let sharpen: (() => void) | null = null
  const adaptation = createAdaptation(ratio => renderer.setPixelRatio(ratio), callbacks.fail)

  const draw = (now: number) => {
    frame = 0
    if (disposed || document.hidden) return
    const elapsed = now - last
    const seconds = Math.min(0.05, elapsed / 1000)
    last = now
    const still = reduced.matches
    rise = still ? 1 : Math.min(1, rise + seconds / 1.5)
    world.scale.y = 0.02 + ease(rise) * 0.98
    const unfolding = content.step(seconds, still, rise)
    const moving = still ? (orbit.snap(), false) : orbit.step(seconds)
    if (moving) adaptation.sample(elapsed, width, height)
    if (sharpen && orbit.view.distance < orbit.home.distance * 0.62) {
      sharpen()
      sharpen = null
    }
    renderer.render(scene, camera)
    host.style.setProperty('--azimuth', `${-orbit.view.azimuth}rad`)
    if (content.plate)
      placeAnchors(overlay, content.locate, world, camera, width, height, rise > 0.6)
    if (!announced && content.plate) {
      announced = true
      callbacks.ready()
    }
    if (moving || unfolding || rise < 1) frame = requestAnimationFrame(draw)
  }
  const poke = () => {
    if (!frame && !disposed) {
      last = performance.now()
      frame = requestAnimationFrame(draw)
    }
  }
  const content = createContent(world, poke)
  void new T.TextureLoader().loadAsync(ICON_ATLAS.url).then(map => {
    map.colorSpace = T.SRGBColorSpace
    map.flipY = false
    if (disposed) return map.dispose()
    setAtlas(map)
    poke()
  })
  const ray = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect()
    raycaster.setFromCamera(
      new T.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    )
  }
  const pick = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect()
    return content.pick(event.clientX - rect.left, event.clientY - rect.top, camera, width, height)
  }
  let hoverFrame = 0
  const unbind = bindOrbit(
    canvas,
    orbit,
    poke,
    event => {
      const point = pick(event)
      if (point) return callbacks.select(point)
      ray(event)
      const surface = content.plate?.mesh.children[0]
      const hit = surface && raycaster.intersectObject(surface)[0]
      if (!hit) return
      const local = world.worldToLocal(hit.point.clone())
      callbacks.ground((local.x + 1) / 2, (local.z + 1) / 2)
    },
    event => {
      cancelAnimationFrame(hoverFrame)
      hoverFrame = requestAnimationFrame(() => {
        const point = event ? pick(event) : null
        canvas.style.cursor = point ? 'pointer' : ''
        callbacks.hover(point)
      })
    },
  )
  const fitView = () => {
    const plate = content.plate
    if (!plate) return
    const visible =
      inset && width > inset * 2 ? (width - inset) / Math.max(1, height) : camera.aspect
    const fit = Math.tan(T.MathUtils.degToRad(camera.fov / 2)) * Math.min(1.5, visible)
    orbit.frame(plate.center, (plate.radius * 1.1) / fit)
  }
  const resize = () => {
    width = host.clientWidth
    height = host.clientHeight
    camera.aspect = width / Math.max(1, height)
    if (inset && width > inset * 2) camera.setViewOffset(width, height, inset / 2, 0, width, height)
    else camera.clearViewOffset()
    camera.updateProjectionMatrix()
    fitView()
    adaptation.apply(width, height)
    renderer.setSize(width, height)
    poke()
  }
  const size = new ResizeObserver(resize)
  size.observe(host)
  const lost = (event: Event) => {
    event.preventDefault()
    if (!disposed) callbacks.fail()
  }
  canvas.addEventListener('webglcontextlost', lost)
  const visibility = () => poke()
  document.addEventListener('visibilitychange', visibility)
  resize()

  return {
    async show(data: DeltaMapData) {
      const token = ++showing
      sharpen = null
      const map = await loadImagery(data.id, 1024).catch(() => null)
      if (disposed || token !== showing) return map?.dispose()
      if (!map) return callbacks.fail()
      content.setMap(data, map)
      inside = null
      level = null
      rise = 0
      fitView()
      orbit.overview()
      if (!announced) {
        orbit.view.polar = 0.001
        orbit.view.azimuth = 0
        orbit.view.distance =
          1.02 / Math.tan(T.MathUtils.degToRad(camera.fov / 2)) / Math.min(1, camera.aspect) +
          content.plate!.lift
      }
      adaptation.settle()
      poke()
      const thrifty = (navigator as { connection?: { saveData?: boolean } }).connection?.saveData
      if (window.innerWidth < 900 || thrifty) return
      const detail = await loadImagery(data.id, 2048).catch(() => null)
      if (disposed || token !== showing || !content.plate) return detail?.dispose()
      if (detail) content.plate.swap(detail)
      poke()
      if (data.detail !== 4096) return
      sharpen = () =>
        void loadImagery(data.id, 4096).then(
          sharp => {
            if (disposed || token !== showing || !content.plate) return sharp.dispose()
            content.plate.swap(sharp)
            poke()
          },
          () => {},
        )
    },
    level(level: number) {
      content.setLevel(level)
      poke()
    },
    kinds(next: ReadonlySet<SandKind>) {
      content.setKinds(next)
      poke()
    },
    building(index: number | null, floor: string | null) {
      const moved = index !== inside || floor !== level
      inside = index
      level = floor
      content.setBuilding(index, floor)
      const stack = content.stack
      if (moved && stack) {
        const { target, distance } = stack.view(floor)
        orbit.aim(target, distance, 0.62)
      } else if (moved) orbit.overview()
      poke()
    },
    route(points: [number, number][]) {
      content.setRoute(points)
      poke()
    },
    night(on: boolean) {
      light(on)
      content.setNight(on)
      poke()
    },
    focus(x: number, y: number, distance?: number) {
      const plate = content.plate
      if (!plate) return
      orbit.aim(
        new T.Vector3(x * 2 - 1, plate.heightAt(x, y) * 0.5, y * 2 - 1),
        distance ?? Math.min(orbit.goal.distance, 1.8),
        0.82,
      )
      poke()
    },
    overview() {
      orbit.overview()
      poke()
    },
    north() {
      orbit.goal.azimuth = Math.round(orbit.goal.azimuth / (Math.PI * 2)) * Math.PI * 2
      poke()
    },
    inset(pixels: number) {
      if (pixels === inset) return
      inset = pixels
      resize()
    },
    zoom(factor: number) {
      orbit.zoom(factor)
      poke()
    },
    relabel: poke,
    destroy() {
      disposed = true
      cancelAnimationFrame(frame)
      cancelAnimationFrame(hoverFrame)
      size.disconnect()
      unbind()
      canvas.removeEventListener('webglcontextlost', lost)
      document.removeEventListener('visibilitychange', visibility)
      content.clear()
      renderer.dispose()
      canvas.remove()
    },
  }
}

export type SandRuntime = NonNullable<Awaited<ReturnType<typeof startSandTable>>>

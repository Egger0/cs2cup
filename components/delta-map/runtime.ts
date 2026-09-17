import * as T from 'three'
import { WebGPURenderer } from 'three/webgpu'
import type { DeltaMapData, SandKind, SandPoint } from '@/lib/delta-sand'
import type { Backend } from '@/components/home/solar/hardware'
import { createAdaptation } from '@/components/home/solar/adapt'
import { buildPlate, loadImagery, type Plate } from './plate'
import { buildMarkers, type Markers } from './markers'
import { bindOrbit, createOrbit } from './orbit'
import { placeAnchors } from './anchors'

export interface SandCallbacks {
  hover: (point: SandPoint | null) => void
  select: (point: SandPoint | null) => void
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
  const sun = new T.DirectionalLight('#ffe9c4', 2.6)
  sun.position.set(-2.2, 1.6, -1.2)
  scene.add(new T.HemisphereLight('#9bcaeb', '#0b0c0b', 1.1), sun)
  const world = new T.Group()
  scene.add(world)
  const camera = new T.PerspectiveCamera(34, 1, 0.02, 40)
  const orbit = createOrbit(camera)
  const canvas = renderer.domElement
  canvas.setAttribute('aria-hidden', 'true')
  host.prepend(canvas)
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const raycaster = new T.Raycaster()
  let plate: Plate | null = null
  let markers: Markers | null = null
  let kinds: ReadonlySet<SandKind> = new Set()
  let rise = 1
  let frame = 0
  let last = performance.now()
  let width = 1
  let height = 1
  let disposed = false
  let announced = false
  let showing = 0
  let shown = ''
  let chosenLevel = 0
  const adaptation = createAdaptation(ratio => renderer.setPixelRatio(ratio), callbacks.fail)

  const clear = () => {
    plate?.dispose()
    for (const child of [...world.children]) {
      world.remove(child)
      child.traverse(object => {
        if (object instanceof T.Mesh || object instanceof T.LineSegments) {
          object.geometry.dispose()
          ;(object.material as T.Material).dispose()
        }
      })
    }
  }
  const draw = (now: number) => {
    frame = 0
    if (disposed || document.hidden) return
    const elapsed = now - last
    const seconds = Math.min(0.05, elapsed / 1000)
    last = now
    const still = reduced.matches
    rise = still ? 1 : Math.min(1, rise + seconds / 1.5)
    world.scale.y = 0.02 + ease(rise) * 0.98
    if (markers) markers.group.visible = rise > 0.55
    const moving = still ? (orbit.snap(), false) : orbit.step(seconds)
    if (moving) adaptation.sample(elapsed, width, height)
    renderer.render(scene, camera)
    if (plate) placeAnchors(overlay, plate, camera, width, height, rise)
    if (!announced && plate) {
      announced = true
      callbacks.ready()
    }
    if (moving || rise < 1) frame = requestAnimationFrame(draw)
  }
  const poke = () => {
    if (!frame && !disposed) {
      last = performance.now()
      frame = requestAnimationFrame(draw)
    }
  }
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
    if (!markers?.group.visible) return null
    ray(event)
    raycaster.params.Line = { threshold: 0 }
    let best: { distance: number; point: SandPoint } | null = null
    for (const { mesh, points } of markers.heads) {
      if (!mesh.parent?.visible) continue
      mesh.computeBoundingSphere()
      for (const hit of raycaster.intersectObject(mesh))
        if (hit.instanceId !== undefined && (!best || hit.distance < best.distance))
          best = { distance: hit.distance, point: points[hit.instanceId]! }
    }
    return best?.point ?? null
  }
  let hoverFrame = 0
  const unbind = bindOrbit(
    canvas,
    orbit,
    poke,
    event => {
      const point = pick(event)
      if (point) return callbacks.select(point)
      if (!plate) return
      ray(event)
      const hit = raycaster.intersectObject(plate.mesh)[0]
      if (hit) {
        orbit.aim(hit.point.setY(0), Math.min(orbit.goal.distance, 1.8))
        poke()
      }
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
    if (!plate) return
    const fit = Math.tan(T.MathUtils.degToRad(camera.fov / 2)) * Math.min(1.5, camera.aspect)
    orbit.frame(plate.center, (plate.radius * 1.1) / fit)
  }
  const resize = () => {
    width = host.clientWidth
    height = host.clientHeight
    camera.aspect = width / Math.max(1, height)
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
      const map = await loadImagery(data.id, 1024).catch(() => null)
      if (disposed || token !== showing) return map?.dispose()
      if (!map) return callbacks.fail()
      clear()
      markers = null
      plate = buildPlate(data, map)
      shown = data.id
      world.add(plate.mesh)
      this.level(data, chosenLevel)
      rise = 0
      fitView()
      orbit.overview()
      if (!announced) {
        orbit.view.polar = 0.001
        orbit.view.azimuth = 0
        orbit.view.distance =
          1.02 / Math.tan(T.MathUtils.degToRad(camera.fov / 2)) / Math.min(1, camera.aspect) +
          plate.lift
      }
      adaptation.settle()
      poke()
      const thrifty = (navigator as { connection?: { saveData?: boolean } }).connection?.saveData
      if (window.innerWidth < 900 || thrifty) return
      const detail = await loadImagery(data.id, 2048).catch(() => null)
      if (disposed || token !== showing || !plate) return detail?.dispose()
      if (detail) plate.swap(detail)
      poke()
    },
    level(data: DeltaMapData, level: number) {
      chosenLevel = level
      if (!plate || shown !== data.id) return
      if (markers) {
        world.remove(markers.group)
        markers.group.traverse(object => {
          if (object instanceof T.Mesh || object instanceof T.LineSegments) {
            object.geometry.dispose()
            ;(object.material as T.Material).dispose()
          }
        })
      }
      markers = buildMarkers(data.levels[level]?.points ?? [], plate)
      markers.show(kinds)
      world.add(markers.group)
      poke()
    },
    kinds(next: ReadonlySet<SandKind>) {
      kinds = next
      markers?.show(next)
      poke()
    },
    focus(x: number, y: number, distance = 1.5) {
      if (!plate) return
      orbit.aim(new T.Vector3(x * 2 - 1, plate.heightAt(x, y) * 0.5, y * 2 - 1), distance, 0.82)
      poke()
    },
    overview() {
      orbit.overview()
      poke()
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
      clear()
      renderer.dispose()
      canvas.remove()
    },
  }
}

export type SandRuntime = NonNullable<Awaited<ReturnType<typeof startSandTable>>>

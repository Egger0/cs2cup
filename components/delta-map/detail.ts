import * as T from 'three'
import {
  dFdx,
  dFdy,
  float,
  min,
  mix,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  vec2,
} from 'three/tsl'
import { DETAIL, detailTileUrl } from '@/lib/delta-sand'

const loader = new T.TextureLoader()
const QUAD = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
] as const

export function createDetail(id: string, base: ReturnType<typeof texture>, changed: () => void) {
  const blanks = QUAD.map(() => new T.Texture())
  const slots = blanks.map(blank => texture(blank))
  const ready = uniform(new T.Vector4())
  const corner = uniform(new T.Vector2())
  const cell = uv().mul(DETAIL.tiles)
  const local = cell.sub(corner)
  const quad = vec2(step(1, local.x), step(1, local.y))
  const [s00, s10, s01, s11] = slots.map(slot =>
    slot.sample(local.sub(quad)).grad(dFdx(cell), dFdy(cell)),
  )
  const edge = min(min(local.x, local.y), min(float(2).sub(local.x), float(2).sub(local.y)))
  const coverage = mix(mix(ready.x, ready.y, quad.x), mix(ready.z, ready.w, quad.x), quad.y)
  const sharp = mix(mix(s00!, s10!, quad.x), mix(s01!, s11!, quad.x), quad.y)
  const node = mix(base, sharp, coverage.mul(smoothstep(0, 0.08, edge)))

  const cache = new Map<string, Promise<T.Texture | null>>()
  let block = ''
  let disposed = false
  const load = (name: string) =>
    loader.loadAsync(detailTileUrl(id, Number(name[0]), Number(name[1]))).then(
      map => {
        map.colorSpace = T.SRGBColorSpace
        map.flipY = false
        map.anisotropy = 8
        if (disposed) map.dispose()
        return map
      },
      () => null,
    )

  return {
    node,
    aim(u: number, v: number) {
      const at = (value: number) =>
        T.MathUtils.clamp(Math.floor(value * DETAIL.tiles - 0.5), 0, DETAIL.tiles - 2)
      const [col, row] = [at(u), at(v)]
      const key = `${col}${row}`
      if (key === block || disposed) return
      block = key
      corner.value.set(col, row)
      ready.value.set(0, 0, 0, 0)
      slots.forEach((slot, index) => (slot.value = blanks[index]!))
      const wanted = QUAD.map(([dx, dy]) => `${col + dx}${row + dy}`)
      wanted.forEach((name, index) => {
        const pending = cache.get(name) ?? load(name)
        cache.set(name, pending)
        void pending.then(map => {
          if (!map || disposed || block !== key) return
          slots[index]!.value = map
          ready.value.setComponent(index, 1)
          changed()
        })
      })
      for (const [name, pending] of cache)
        if (cache.size > 8 && !wanted.includes(name)) {
          cache.delete(name)
          void pending.then(map => map?.dispose())
        }
    },
    dispose() {
      disposed = true
      for (const pending of cache.values()) void pending.then(map => map?.dispose())
      cache.clear()
    },
  }
}

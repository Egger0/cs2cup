import * as T from 'three'
import { texture } from 'three/tsl'
import { PLANET_COLORS } from '@/lib/planets'

const loader = new T.TextureLoader()
const CHANNELS = ['relief', 'albedo', 'roughness']
const SURFACE: Record<string, number> = { CS2: 4096 }

export const mapKind = (slug: string) => (PLANET_COLORS.has(slug) ? slug : 'terrain')
export type PlanetMaps = Awaited<ReturnType<typeof planetMaps>>

async function load(kind: string, channel: string, size: number) {
  const map = await loader.loadAsync(`/models/${kind}-${channel}-${size}.webp`)
  await (map.image as HTMLImageElement).decode().catch(() => {})
  map.wrapS = T.RepeatWrapping
  map.anisotropy = 8
  if (channel === 'albedo') map.colorSpace = T.SRGBColorSpace
  return map
}

export async function planetMaps(kind: string) {
  const nodes = (await Promise.all(CHANNELS.map(channel => load(kind, channel, 512)))).map(map =>
    texture(map),
  )
  let detail: Promise<void> | null = null
  let loading: Promise<void> | null = null
  const swap = (maps: T.Texture[]) =>
    maps.forEach((map, index) => {
      const node = nodes[index]!
      node.value.dispose()
      node.value = map
    })
  return {
    relief: nodes[0]!,
    albedo: nodes[1]!,
    roughness: nodes[2]!,
    dispose: () => nodes.forEach(node => node.value.dispose()),
    promote() {
      if (loading) return loading
      detail ??= Promise.all(CHANNELS.map(channel => load(kind, channel, 2048))).then(maps => {
        if (loading) maps.forEach(map => map.dispose())
        else swap(maps)
      })
      return detail
    },
    upgrade(depth: number) {
      const size = SURFACE[kind]
      if (depth < 2 || !size) return Promise.resolve()
      loading ??= Promise.all(CHANNELS.map(channel => load(kind, channel, size))).then(swap)
      return loading
    },
  }
}

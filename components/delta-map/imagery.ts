import * as T from 'three'
import { mapImageUrl, type DeltaMapData } from '@/lib/delta-sand'
import type { Plate } from './plate'

const loader = new T.TextureLoader()

export async function loadImagery(id: string, size: 1024 | 2048 | 4096) {
  const map = await loader.loadAsync(mapImageUrl(id, size))
  await (map.image as HTMLImageElement).decode().catch(() => {})
  map.colorSpace = T.SRGBColorSpace
  map.flipY = false
  map.anisotropy = 8
  return map
}

export function refineImagery(
  data: DeltaMapData,
  plate: Plate,
  alive: () => boolean,
  poke: () => void,
) {
  const thrifty = (navigator as { connection?: { saveData?: boolean } }).connection?.saveData
  const wide = window.innerWidth >= 900
  const fine = wide && data.detail === 8192
  let chain = Promise.resolve()
  let stage = 0
  const upgrade = (size: 2048 | 4096) =>
    (chain = chain.then(() =>
      loadImagery(data.id, size).then(
        map => (alive() ? (plate.swap(map), poke()) : map.dispose()),
        () => {},
      ),
    ))
  return (closeness: number, target: T.Vector3) => {
    if (thrifty) return
    if (stage < 1 && (wide || closeness < 0.62)) {
      stage = 1
      void upgrade(2048)
    }
    if (stage < 2 && fine && closeness < 0.62) {
      stage = 2
      void upgrade(4096)
    }
    if (fine && closeness < 0.45) plate.aim((target.x + 1) / 2, (target.z + 1) / 2)
  }
}

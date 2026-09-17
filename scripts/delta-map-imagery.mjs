import sharp from 'sharp'

const TILES = 'https://game.gtimg.cn/images/dfm/cp/a20240729directory/img/'
export const SEA = { r: 21, g: 28, b: 34 }
export const SIZES = [1024, 2048]

export const isWater = (r, g, b) => b - r >= 7 && b < 64 && g < 60

export function tileWindow([u0, v0, side], tile, world) {
  const size = Math.round(side * world)
  const left = Math.round(u0 * world)
  const top = Math.round(v0 * world)
  const count = world / tile
  const range = start => {
    const first = Math.max(0, Math.floor(start / tile))
    const last = Math.min(count - 1, Math.floor((start + size - 1) / tile))
    return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => first + index)
  }
  return {
    size,
    tiles: range(left).flatMap(x =>
      range(top).map(y => ({ x, y, left: x * tile - left, top: y * tile - top })),
    ),
  }
}

async function fetchTile(layer, zoom, x, y, tile) {
  const response = await fetch(`${TILES}${layer}/${zoom}_${x}_${y}.jpg`)
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) return null
  return sharp(Buffer.from(await response.arrayBuffer()))
    .resize(tile, tile)
    .toBuffer()
}

export async function mosaic({ layer, zoom, tile, world, frame, required = 0.9 }) {
  const { size, tiles } = tileWindow(frame, tile, world)
  const pad = Math.max(0, ...tiles.flatMap(entry => [-entry.left, -entry.top]))
  const inputs = []
  const queue = [...tiles]
  await Promise.all(
    Array.from({ length: 12 }, async () => {
      for (let entry = queue.pop(); entry; entry = queue.pop()) {
        const input = await fetchTile(layer, zoom, entry.x, entry.y, tile)
        if (input) inputs.push({ input, left: entry.left + pad, top: entry.top + pad })
      }
    }),
  )
  if (inputs.length < tiles.length * required)
    throw new Error(`${layer}: only ${inputs.length}/${tiles.length} tiles answered`)
  const span = size + pad * 2 + tile * 2
  const stitched = await sharp({
    create: { width: span, height: span, channels: 3, background: SEA },
  })
    .composite(inputs)
    .png()
    .toBuffer()
  return sharp(stitched)
    .extract({ left: pad, top: pad, width: size, height: size })
    .png()
    .toBuffer()
}

export async function buildImagery(layer, frame, grid, write) {
  const canvas = await mosaic({ layer, zoom: 4, tile: 256, world: 4096, frame })
  for (const width of SIZES)
    await write(width, await sharp(canvas).resize(width, width).webp({ quality: 78 }).toBuffer())
  const { data, info } = await sharp(canvas)
    .resize(grid, grid, { kernel: 'cubic' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const water = new Uint8Array(grid * grid)
  for (let index = 0; index < water.length; index++) {
    const at = index * info.channels
    water[index] = isWater(data[at], data[at + 1], data[at + 2]) ? 255 : 0
  }
  return water
}

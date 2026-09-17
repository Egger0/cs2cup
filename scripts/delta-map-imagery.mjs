import sharp from 'sharp'

const TILES = 'https://game.gtimg.cn/images/dfm/cp/a20240729directory/img/'
const ZOOM = 4
const TILE = 256
const WORLD = TILE * 2 ** ZOOM
export const SEA = { r: 21, g: 28, b: 34 }
export const SIZES = [1024, 2048]

export const isWater = (r, g, b) => b - r >= 7 && b < 64 && g < 60

export function tileWindow([u0, v0, side]) {
  const size = Math.round(side * WORLD)
  const left = Math.round(u0 * WORLD)
  const top = Math.round(v0 * WORLD)
  const range = start => {
    const first = Math.max(0, Math.floor(start / TILE))
    const last = Math.min(2 ** ZOOM - 1, Math.floor((start + size - 1) / TILE))
    return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => first + index)
  }
  return {
    size,
    tiles: range(left).flatMap(x =>
      range(top).map(y => ({ x, y, left: x * TILE - left, top: y * TILE - top })),
    ),
  }
}

async function fetchTile(layer, x, y) {
  const response = await fetch(`${TILES}${layer}/${ZOOM}_${x}_${y}.jpg`)
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) return null
  return Buffer.from(await response.arrayBuffer())
}

export async function buildImagery(layer, frame, grid, write) {
  const { size, tiles } = tileWindow(frame)
  const pad = Math.max(0, ...tiles.flatMap(tile => [-tile.left, -tile.top]))
  const inputs = []
  const queue = [...tiles]
  await Promise.all(
    Array.from({ length: 12 }, async () => {
      for (let tile = queue.pop(); tile; tile = queue.pop()) {
        const input = await fetchTile(layer, tile.x, tile.y)
        if (input) inputs.push({ input, left: tile.left + pad, top: tile.top + pad })
      }
    }),
  )
  if (inputs.length < tiles.length * 0.9)
    throw new Error(`${layer}: only ${inputs.length}/${tiles.length} tiles answered`)
  const span = size + pad * 2 + TILE * 2
  const mosaic = await sharp({
    create: { width: span, height: span, channels: 3, background: SEA },
  })
    .composite(inputs)
    .png()
    .toBuffer()
  const canvas = await sharp(mosaic)
    .extract({ left: pad, top: pad, width: size, height: size })
    .png()
    .toBuffer()
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

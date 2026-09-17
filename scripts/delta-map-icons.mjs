import sharp from 'sharp'

const ICONS = 'https://game.gtimg.cn/images/dfm/cp/a20240729directory/img/lv3/'
export const CELL = 96
export const COLUMNS = 8

export function createIconAtlas() {
  const order = []
  return {
    indexOf(icon) {
      if (!icon) return -1
      if (!order.includes(icon)) order.push(icon)
      return order.indexOf(icon)
    },
    async render() {
      const cells = await Promise.all(
        order.map(async (icon, index) => {
          const response = await fetch(`${ICONS}${icon}.png`)
          if (!response.ok || !response.headers.get('content-type')?.startsWith('image/'))
            return null
          const input = await sharp(Buffer.from(await response.arrayBuffer()))
            .resize(CELL, CELL, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toBuffer()
          return { input, left: (index % COLUMNS) * CELL, top: Math.floor(index / COLUMNS) * CELL }
        }),
      )
      const rows = Math.max(1, Math.ceil(order.length / COLUMNS))
      return sharp({
        create: {
          width: COLUMNS * CELL,
          height: rows * CELL,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite(cells.filter(Boolean))
        .webp({ quality: 86, alphaQuality: 90 })
        .toBuffer()
    },
  }
}

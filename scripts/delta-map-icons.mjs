import sharp from 'sharp'

const SOURCE = 'https://game.gtimg.cn/images/dfm/cp/a20240729directory/'
export const CELL = 96
export const COLUMNS = 8

export function inlineIcon(css, icon) {
  const match = css.match(
    new RegExp(`\\.img_nav_${icon}\\s*\\{[^}]*?url\\("?data:image/png;base64,([A-Za-z0-9+/=]+)`),
  )
  return match ? Buffer.from(match[1], 'base64') : null
}

async function artwork(icon, css) {
  const response = await fetch(`${SOURCE}img/lv3/${icon}.png`)
  if (response.ok && response.headers.get('content-type')?.startsWith('image/'))
    return Buffer.from(await response.arrayBuffer())
  return inlineIcon(css, icon)
}

export function createIconAtlas() {
  const order = []
  return {
    indexOf(icon) {
      if (!icon) return -1
      if (!order.includes(icon)) order.push(icon)
      return order.indexOf(icon)
    },
    async render() {
      const css = await fetch(`${SOURCE}main.css`).then(response => response.text())
      const cells = await Promise.all(
        order.map(async (icon, index) => {
          const source = await artwork(icon, css)
          if (!source) {
            console.warn(`No official artwork for icon ${icon}`)
            return null
          }
          const input = await sharp(source)
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

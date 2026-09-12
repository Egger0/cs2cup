import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import { PLANET_COLORS } from '../lib/planets.ts'
import { field, fractal, clamp } from './solar-texture-field.mjs'
const smooth = t => t * t * (3 - 2 * t)
await mkdir('public/models', { recursive: true })
for (const [index, kind] of [...PLANET_COLORS.keys(), 'terrain'].entries()) {
  const tiers = kind === 'CS2' ? [4096, 2048, 512] : [2048, 512]
  const width = tiers[0]
  const height = width / 2
  const relief = Buffer.alloc(width * height)
  const albedo = Buffer.alloc(width * height * 3)
  const roughness = Buffer.alloc(width * height)
  const craters = Array.from({ length: 28 }, (_, i) => {
    const a = i * 2.39996,
      y = 1 - (i + 0.5) / 14,
      r = Math.sqrt(1 - y * y)
    return [Math.cos(a) * r, y, Math.sin(a) * r, 0.018 + field(i, index, 9) * 0.085]
  })
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const phi = (x / (width - 1)) * Math.PI * 2,
        theta = (y / (height - 1)) * Math.PI
      const px = -Math.cos(phi) * Math.sin(theta),
        py = Math.cos(theta),
        pz = Math.sin(phi) * Math.sin(theta)
      const warp = fractal(px * 3 + index * 13, py * 3, pz * 3, 4)
      const a = px * 9 + warp * 4,
        b = py * 9 + warp * 2,
        c = pz * 9 + warp * 3
      const land = fractal(a, b, c, 6)
      const ridge = 1 - Math.abs(field(a * 2, b * 2, c * 2) * 2 - 1)
      const grain = field(px * 620, py * 620, pz * 620)
      const i = y * width + x
      if (kind === 'CS2') {
        const level = clamp((land - 0.2) * 1.7) * 7
        const step = level - Math.floor(level)
        const terrace = (Math.floor(level) + smooth(clamp((step - 0.72) / 0.28))) / 7
        const cliff = clamp(1 - Math.abs(step - 0.86) * 8)
        const lowland = clamp((0.42 - terrace) * 4)
        const dune =
          (Math.sin(
            (px * 0.8 + pz * 0.6) * 240 + warp * 22 + field(px * 30, py * 30, pz * 30) * 5,
          ) *
            0.5 +
            0.5) *
          lowland
        const canyon = Math.pow(ridge, 14) * clamp((terrace - 0.25) * 3)
        relief[i] = clamp(0.2 + terrace * 0.66 + dune * 0.05 - canyon * 0.2 + grain * 0.02) * 255
        roughness[i] = clamp(0.93 - terrace * 0.14 + cliff * 0.05) * 255
        const shade = clamp(
          0.6 + terrace * 0.4 - cliff * 0.24 - canyon * 0.34 + dune * 0.07 + grain * 0.04,
        )
        const mineral = [1, 0.95 - cliff * 0.05, 0.84 - cliff * 0.1 + terrace * 0.1]
        for (let channel = 0; channel < 3; channel++)
          albedo[i * 3 + channel] = clamp(shade * mineral[channel]) * 255
        continue
      }
      const strata = Math.sin(land * 110 + py * 25) * 0.5 + 0.5
      const channel = Math.pow(clamp(1 - Math.abs(land - 0.46) * 37), 3)
      let crater = 0
      if (kind !== 'VALORANT')
        for (const [cx, cy, cz, r] of craters) {
          const distance = Math.hypot(px - cx, py - cy, pz - cz) / r
          if (distance < 1.3)
            crater +=
              Math.exp(-(((distance - 1) * 12) ** 2)) * 0.2 -
              Math.max(0, 1 - distance * distance) * 0.21
        }
      const rock = clamp((land - 0.34) * 3 + ridge * 0.12)
      const brightness = clamp(
        0.46 + rock * 0.49 + strata * 0.055 - channel * 0.19 + crater * 0.8 + grain * 0.035,
      )
      relief[i] =
        clamp(0.28 + land * 0.48 + ridge * 0.09 - channel * 0.09 + crater + grain * 0.025) * 255
      roughness[i] = clamp(0.75 + rock * 0.18 - strata * 0.04) * 255
      for (let channel = 0; channel < 3; channel++) albedo[i * 3 + channel] = brightness * 255
    }
  for (const [name, pixels, channels] of [
    ['relief', relief, 1],
    ['albedo', albedo, 3],
    ['roughness', roughness, 1],
  ])
    for (const tier of tiers)
      await sharp(pixels, { raw: { width, height, channels } })
        .resize(tier, tier / 2)
        .webp({ quality: tier > 512 ? 92 : 82 })
        .toFile(`public/models/${kind}-${name}-${tier}.webp`)
}

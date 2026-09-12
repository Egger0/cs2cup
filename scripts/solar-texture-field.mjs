const hash = (x, y, z) => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}
export function field(x, y, z) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z)
  const smooth = t => t * t * (3 - 2 * t)
  const u = smooth(x - ix),
    v = smooth(y - iy),
    w = smooth(z - iz)
  let value = 0
  for (let a = 0; a < 2; a++)
    for (let b = 0; b < 2; b++)
      for (let c = 0; c < 2; c++)
        value += hash(ix + a, iy + b, iz + c) * (a ? u : 1 - u) * (b ? v : 1 - v) * (c ? w : 1 - w)
  return value
}
export function fractal(x, y, z, octaves = 5) {
  let value = 0,
    amplitude = 0.5
  for (let i = 0; i < octaves; i++) {
    value += field(x, y, z) * amplitude
    x = x * 2.03 + 7.1
    y = y * 2.03 + 3.7
    z = z * 2.03 + 1.9
    amplitude *= 0.5
  }
  return value
}
export const clamp = v => Math.max(0, Math.min(1, v))

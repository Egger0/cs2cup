import { MathUtils } from 'three'
export function solarEase(x: number) {
  let t = x
  for (let i = 0; i < 7; i++) {
    const inv = 1 - t
    const bx = 3 * inv * inv * t * 0.16 + 3 * inv * t * t * 0.3 + t * t * t
    const dx = 3 * inv * inv * 0.16 + 6 * inv * t * 0.14 + 3 * t * t * 0.7
    t = MathUtils.clamp(t - (bx - x) / Math.max(dx, 0.001), 0, 1)
  }
  return 1 - Math.pow(1 - t, 3)
}

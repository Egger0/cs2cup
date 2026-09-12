const PIXELS = 2.8e6

const budget = (width: number, height: number) =>
  Math.max(1, Math.min(devicePixelRatio, 2, Math.sqrt(PIXELS / Math.max(1, width * height))))

export function createAdaptation(setPixelRatio: (ratio: number) => void, fail: () => void) {
  let scale = 1
  let ratio = 0
  let checks = 0
  let samples: number[] = []
  let steady = 0

  const apply = (width: number, height: number) => {
    const next = Math.max(0.6, budget(width, height) * scale)
    if (Math.abs(next - ratio) < 0.01) return
    ratio = next
    setPixelRatio(ratio)
  }

  return {
    apply,
    settle() {
      steady = performance.now() + 1000
      samples = []
    },
    sample(elapsed: number, width: number, height: number) {
      if (performance.now() < steady) return
      samples.push(elapsed)
      if (samples.length < 24) return
      const sorted = [...samples].sort((a, b) => a - b)
      const floor = sorted[Math.floor(sorted.length * 0.1)]!
      const middle = sorted[Math.floor(sorted.length * 0.5)]!
      const misses = samples.filter(value => value > floor * 1.6).length / samples.length
      samples = []
      checks++
      if ((misses > 0.15 || middle > 20) && scale > 0.5) {
        scale = Math.max(0.5, scale - 0.15)
        apply(width, height)
      } else if (middle > 50 && checks <= 3) fail()
    },
  }
}

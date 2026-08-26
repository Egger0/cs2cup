let current = typeof window === 'undefined' ? 0 : Date.now()
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

export function subscribeToClock(listener: () => void) {
  listeners.add(listener)

  if (timer === null) {
    timer = setInterval(() => {
      current = Date.now()
      for (const notify of listeners) notify()
    }, 1000)
  }

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

export function readClock() {
  return current
}

export function readServerClock() {
  return 0
}

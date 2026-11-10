'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import styles from './AppShell.module.css'

const EDGE = 24
const TRIGGER = 90

export function AppShell() {
  const router = useRouter()
  const cue = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator)
      void navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, [])

  useEffect(() => {
    if (!window.matchMedia('(display-mode: standalone)').matches) return
    let start: { x: number; y: number } | null = null
    let pull = 0
    const paint = (distance: number) => {
      pull = distance
      cue.current?.style.setProperty('--pull', String(Math.min(distance / TRIGGER, 1)))
    }
    const down = (event: TouchEvent) => {
      const touch = event.touches[0]
      start =
        touch && touch.clientX <= EDGE && history.length > 1
          ? { x: touch.clientX, y: touch.clientY }
          : null
    }
    const move = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!start || !touch) return
      const dx = touch.clientX - start.x
      if (Math.abs(touch.clientY - start.y) > dx) {
        start = null
        return paint(0)
      }
      paint(Math.max(dx, 0))
    }
    const end = () => {
      if (start && pull >= TRIGGER) {
        navigator.vibrate?.(8)
        router.back()
      }
      start = null
      paint(0)
    }
    addEventListener('touchstart', down, { passive: true })
    addEventListener('touchmove', move, { passive: true })
    addEventListener('touchend', end, { passive: true })
    addEventListener('touchcancel', end, { passive: true })
    return () => {
      removeEventListener('touchstart', down)
      removeEventListener('touchmove', move)
      removeEventListener('touchend', end)
      removeEventListener('touchcancel', end)
    }
  }, [router])

  return <div ref={cue} className={styles.cue} aria-hidden />
}

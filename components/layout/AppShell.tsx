'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useTransition } from 'react'
import styles from './AppShell.module.css'

const EDGE = 24
const TRIGGER = 90

type Gesture = { kind: 'back' | 'refresh'; x: number; y: number; distance: number }

export function AppShell() {
  const router = useRouter()
  const back = useRef<HTMLDivElement>(null)
  const refresh = useRef<HTMLDivElement>(null)
  const [refreshing, startRefresh] = useTransition()

  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator)
      void navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, [])

  useEffect(() => {
    if (!window.matchMedia('(display-mode: standalone)').matches) return
    let gesture: Gesture | null = null
    const paint = (next: Gesture | null) => {
      for (const [kind, cue] of [
        ['back', back.current],
        ['refresh', refresh.current],
      ] as const) {
        const pull = next?.kind === kind ? Math.min(next.distance / TRIGGER, 1) : 0
        cue?.style.setProperty('--pull', String(pull))
      }
    }
    const down = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!touch || event.touches.length > 1) return
      const inDialog = (event.target as Element | null)?.closest?.('dialog')
      if (inDialog) gesture = null
      else if (touch.clientX <= EDGE && history.length > 1)
        gesture = { kind: 'back', x: touch.clientX, y: touch.clientY, distance: 0 }
      else if (scrollY <= 0)
        gesture = { kind: 'refresh', x: touch.clientX, y: touch.clientY, distance: 0 }
      else gesture = null
    }
    const move = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!gesture || !touch) return
      const dx = touch.clientX - gesture.x
      const dy = touch.clientY - gesture.y
      const [along, across] = gesture.kind === 'back' ? [dx, dy] : [dy, dx]
      if (Math.abs(across) > Math.max(along, 12) || (gesture.kind === 'refresh' && scrollY > 0)) {
        gesture = null
        return paint(null)
      }
      gesture.distance = Math.max(along, 0) * (gesture.kind === 'refresh' ? 0.6 : 1)
      paint(gesture)
    }
    const end = () => {
      const done = gesture && gesture.distance >= TRIGGER ? gesture.kind : null
      gesture = null
      paint(null)
      if (!done) return
      navigator.vibrate?.(8)
      if (done === 'back') router.back()
      else startRefresh(() => router.refresh())
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

  return (
    <>
      <div ref={back} className={styles.back} aria-hidden />
      <div
        ref={refresh}
        className={styles.refresh}
        data-busy={refreshing ? '' : undefined}
        aria-hidden
      />
    </>
  )
}

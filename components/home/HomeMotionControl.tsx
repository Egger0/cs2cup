'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import styles from './HomeMotionControl.module.css'

const MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const POINTER_QUERY = '(hover: hover) and (pointer: fine)'
const subscribe = (callback: () => void) => {
  const query = window.matchMedia(MOTION_QUERY)
  query.addEventListener('change', callback)
  return () => query.removeEventListener('change', callback)
}
const getReducedMotion = () => window.matchMedia(MOTION_QUERY).matches
const getServerSnapshot = () => true

export function HomeMotionControl() {
  const reducedMotion = useSyncExternalStore(subscribe, getReducedMotion, getServerSnapshot)
  const [paused, setPaused] = useState(false)
  const enabled = !reducedMotion && !paused

  useEffect(() => {
    const cover = document.querySelector<HTMLElement>('[data-home-cover]')
    if (!cover) return
    const root = document.documentElement
    const pointer = window.matchMedia(POINTER_QUERY)
    let inView = true
    let frame = 0
    let point = { x: 0, y: 0 }
    const reset = () => {
      cancelAnimationFrame(frame)
      frame = 0
      for (const property of ['--aim-x', '--aim-y', '--tilt-x', '--tilt-y']) {
        cover.style.removeProperty(property)
      }
    }
    const synchronize = () => {
      root.dataset.homeEffects = enabled && !document.hidden ? 'active' : 'paused'
      cover.dataset.motionState = enabled && inView && !document.hidden ? 'active' : 'paused'
      if (!enabled || !inView || document.hidden || !pointer.matches) reset()
    }
    const move = (event: PointerEvent) => {
      if (
        !enabled ||
        !inView ||
        document.hidden ||
        !pointer.matches ||
        event.pointerType !== 'mouse'
      )
        return
      point = { x: event.clientX, y: event.clientY }
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const box = cover.getBoundingClientRect()
        const x = Math.max(-1, Math.min(1, ((point.x - box.left) / box.width - 0.5) * 2))
        const y = Math.max(-1, Math.min(1, ((point.y - box.top) / box.height - 0.5) * 2))
        cover.style.setProperty('--aim-x', `${x * 12}px`)
        cover.style.setProperty('--aim-y', `${y * 9}px`)
        cover.style.setProperty('--tilt-x', `${-y * 5}deg`)
        cover.style.setProperty('--tilt-y', `${x * 7}deg`)
      })
    }
    const observer = new IntersectionObserver(([entry]) => {
      inView = Boolean(entry?.isIntersecting)
      synchronize()
    })
    observer.observe(cover)
    cover.addEventListener('pointermove', move, { passive: true })
    cover.addEventListener('pointerleave', reset)
    pointer.addEventListener('change', synchronize)
    document.addEventListener('visibilitychange', synchronize)
    synchronize()
    return () => {
      observer.disconnect()
      reset()
      cover.removeEventListener('pointermove', move)
      cover.removeEventListener('pointerleave', reset)
      pointer.removeEventListener('change', synchronize)
      document.removeEventListener('visibilitychange', synchronize)
      delete cover.dataset.motionState
      delete root.dataset.homeEffects
    }
  }, [enabled])

  return (
    <button
      type="button"
      className={styles.control}
      aria-pressed={enabled}
      disabled={reducedMotion}
      title={
        reducedMotion ? '遵循系统的减少动态效果设置' : enabled ? '暂停装饰动效' : '开启装饰动效'
      }
      onClick={() => setPaused(value => !value)}
    >
      <span className={styles.symbol} aria-hidden="true">
        {enabled ? 'Ⅱ' : '▷'}
      </span>
      动态效果
      <span className={styles.state} aria-hidden="true">
        {enabled ? 'ON' : 'OFF'}
      </span>
    </button>
  )
}

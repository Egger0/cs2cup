'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import styles from './HomeMotionControl.module.css'

const MOTION_QUERY = '(prefers-reduced-motion: reduce)'
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
    const root = document.documentElement
    const synchronize = () => {
      root.dataset.homeEffects = enabled && !document.hidden ? 'active' : 'paused'
    }
    synchronize()
    document.addEventListener('visibilitychange', synchronize)
    return () => {
      document.removeEventListener('visibilitychange', synchronize)
      delete root.dataset.homeEffects
    }
  }, [enabled])

  return (
    <button
      type="button"
      className={styles.control}
      aria-label="动态效果"
      aria-pressed={enabled}
      disabled={reducedMotion}
      title={
        reducedMotion ? '遵循系统的减少动态效果设置' : enabled ? '暂停动态效果' : '开启动态效果'
      }
      onClick={() => setPaused(value => !value)}
    >
      <span className={enabled ? styles.pause : styles.play} aria-hidden="true" />
    </button>
  )
}

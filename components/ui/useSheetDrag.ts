'use client'

import { useEffect, type RefObject } from 'react'

const CLOSE_DISTANCE = 120
const CLOSE_VELOCITY = 0.6

export function useSheetDrag(ref: RefObject<HTMLDialogElement | null>, onClose?: () => void) {
  useEffect(() => {
    const element = ref.current
    if (!element) return
    let start: { y: number; at: number } | null = null
    let distance = 0
    let velocity = 0

    const reset = () => {
      element.style.removeProperty('transition')
      element.style.removeProperty('translate')
      element.removeAttribute('data-dragging')
    }
    const down = (event: TouchEvent) => {
      const touch = event.touches[0]
      start =
        touch && event.touches.length === 1 && element.scrollTop <= 0
          ? { y: touch.clientY, at: event.timeStamp }
          : null
      distance = 0
      velocity = 0
    }
    const move = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!start || !touch) return
      const next = touch.clientY - start.y
      if (next <= 0 && distance === 0) {
        start = null
        return
      }
      event.preventDefault()
      const elapsed = Math.max(event.timeStamp - start.at, 1)
      velocity = (next - distance) / Math.min(elapsed, 32)
      start.at = event.timeStamp
      distance = Math.max(next, 0)
      element.setAttribute('data-dragging', '')
      element.style.transition = 'none'
      element.style.translate = `0 ${distance}px`
    }
    const up = () => {
      if (!start) return
      const dismiss = distance > CLOSE_DISTANCE || (distance > 24 && velocity > CLOSE_VELOCITY)
      start = null
      reset()
      if (!dismiss) return
      navigator.vibrate?.(8)
      if (onClose) onClose()
      else element.close()
    }

    element.addEventListener('touchstart', down, { passive: true })
    element.addEventListener('touchmove', move, { passive: false })
    element.addEventListener('touchend', up, { passive: true })
    element.addEventListener('touchcancel', up, { passive: true })
    return () => {
      element.removeEventListener('touchstart', down)
      element.removeEventListener('touchmove', move)
      element.removeEventListener('touchend', up)
      element.removeEventListener('touchcancel', up)
      reset()
    }
  }, [ref, onClose])
}

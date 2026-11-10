'use client'

import { useEffect, type RefObject } from 'react'

const clamp = (value: number) => Math.min(1, Math.max(-1, value))
const unit = (value: number, from: number, to: number) =>
  clamp(((value - from) / (to - from)) * 2 - 1)

type OrientationPermission = { requestPermission?: () => Promise<string> }

export function useTilt(ref: RefObject<HTMLElement | null>, mode: 'stage' | 'thumb') {
  useEffect(() => {
    const card = ref.current
    if (!card) return
    const motion = matchMedia('(prefers-reduced-motion: no-preference)')
    let visible = false
    let [x, y, tx, ty, frame] = [0, 0, 0, 0, 0]
    const step = () => {
      x += (tx - x) * 0.14
      y += (ty - y) * 0.14
      card.style.setProperty('--x', x.toFixed(4))
      card.style.setProperty('--y', y.toFixed(4))
      frame = Math.abs(tx - x) + Math.abs(ty - y) > 0.002 ? requestAnimationFrame(step) : 0
    }
    const aim = (nx: number, ny: number) => {
      if (!visible) return
      ;[tx, ty] = motion.matches ? [nx, ny] : [0, 0]
      frame ||= requestAnimationFrame(step)
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting)
    })
    observer.observe(card)

    const local = (event: PointerEvent) => {
      const box = card.getBoundingClientRect()
      aim(unit(event.clientX, box.left, box.right), unit(event.clientY, box.top, box.bottom))
    }
    const rest = () => aim(0, 0)
    const page = (event: PointerEvent) => {
      if (event.pointerType === 'mouse')
        aim(unit(event.clientX, 0, innerWidth), unit(event.clientY, 0, innerHeight))
    }
    const orient = ({ beta, gamma }: DeviceOrientationEvent) => {
      if (beta === null || gamma === null) return
      const landscape = matchMedia('(orientation: landscape)').matches
      aim(
        unit(landscape ? beta : gamma, -45, 45),
        -unit(landscape ? Math.abs(gamma) : beta, 20, 70),
      )
    }
    const request = (DeviceOrientationEvent as unknown as OrientationPermission).requestPermission
    const ask = () =>
      request?.().then(
        state => state === 'granted' && addEventListener('deviceorientation', orient),
        () => {},
      )

    if (mode === 'thumb') {
      card.addEventListener('pointermove', local)
      card.addEventListener('pointerleave', rest)
    } else {
      addEventListener('pointermove', page)
      document.documentElement.addEventListener('pointerleave', rest)
      if (request) card.addEventListener('click', ask, { once: true })
      else addEventListener('deviceorientation', orient)
    }
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      card.removeEventListener('pointermove', local)
      card.removeEventListener('pointerleave', rest)
      card.removeEventListener('click', ask)
      removeEventListener('pointermove', page)
      document.documentElement.removeEventListener('pointerleave', rest)
      removeEventListener('deviceorientation', orient)
    }
  }, [ref, mode])
}

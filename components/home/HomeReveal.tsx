'use client'

import { useEffect } from 'react'

export function HomeReveal() {
  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-home-reveal]'))
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      elements.forEach(element => {
        element.dataset.visible = 'true'
      })
      return
    }

    document.documentElement.dataset.homeMotion = 'ready'
    const pending = new Set(elements)
    let frame = 0
    const revealPassedElements = () => {
      frame = 0
      pending.forEach(element => {
        if (element.getBoundingClientRect().top < window.innerHeight * 0.94) {
          element.dataset.visible = 'true'
          pending.delete(element)
        }
      })
      if (pending.size === 0) {
        window.removeEventListener('scroll', scheduleReveal)
        window.removeEventListener('resize', scheduleReveal)
      }
    }
    const scheduleReveal = () => {
      if (frame) return
      frame = window.requestAnimationFrame(revealPassedElements)
    }

    frame = window.requestAnimationFrame(revealPassedElements)
    window.addEventListener('scroll', scheduleReveal, { passive: true })
    window.addEventListener('resize', scheduleReveal)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', scheduleReveal)
      window.removeEventListener('resize', scheduleReveal)
      delete document.documentElement.dataset.homeMotion
    }
  }, [])

  return null
}

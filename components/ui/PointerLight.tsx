'use client'

import { useEffect } from 'react'

export function PointerLight() {
  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    let lit: HTMLElement | null = null
    const move = (event: PointerEvent) => {
      const card = (event.target as Element).closest<HTMLElement>('[data-light]')
      if (card !== lit) {
        lit?.removeAttribute('data-lit')
        lit?.style.setProperty('--tx', '0')
        lit?.style.setProperty('--ty', '0')
        card?.setAttribute('data-lit', '')
        lit = card
      }
      if (!card) return
      const box = card.getBoundingClientRect()
      card.style.setProperty('--px', `${event.clientX - box.left}px`)
      card.style.setProperty('--py', `${event.clientY - box.top}px`)
      card.style.setProperty('--tx', (((event.clientX - box.left) / box.width) * 2 - 1).toFixed(3))
      card.style.setProperty('--ty', (((event.clientY - box.top) / box.height) * 2 - 1).toFixed(3))
    }
    document.addEventListener('pointermove', move, { passive: true })
    return () => document.removeEventListener('pointermove', move)
  }, [])
  return null
}

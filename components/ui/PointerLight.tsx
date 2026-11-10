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
        card?.setAttribute('data-lit', '')
        lit = card
      }
      if (!card) return
      const box = card.getBoundingClientRect()
      card.style.setProperty('--px', `${event.clientX - box.left}px`)
      card.style.setProperty('--py', `${event.clientY - box.top}px`)
    }
    document.addEventListener('pointermove', move, { passive: true })
    return () => document.removeEventListener('pointermove', move)
  }, [])
  return null
}

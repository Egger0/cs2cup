'use client'

import { useEffect } from 'react'

export function HomeReveal() {
  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-home-reveal]'))
    const reveal = (element: HTMLElement) => {
      element.dataset.visible = 'true'
    }
    if (
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !('IntersectionObserver' in window)
    ) {
      elements.forEach(reveal)
      return
    }
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            reveal(entry.target as HTMLElement)
            observer.unobserve(entry.target)
          }
        }
      },
      { rootMargin: '0px 0px -6% 0px' },
    )
    for (const element of elements) {
      if (element.getBoundingClientRect().top < window.innerHeight * 0.94) reveal(element)
      else observer.observe(element)
    }
    document.documentElement.dataset.homeMotion = 'ready'
    return () => {
      observer.disconnect()
      delete document.documentElement.dataset.homeMotion
    }
  }, [])

  return null
}

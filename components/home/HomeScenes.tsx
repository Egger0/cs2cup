'use client'

import { useEffect } from 'react'

const clamp = (value: number) => Math.min(1, Math.max(0, value))

function reveal(scene: HTMLElement) {
  for (const image of scene.querySelectorAll<HTMLImageElement>('img[data-src]')) {
    if (image.dataset.srcset) image.srcset = image.dataset.srcset
    image.src = image.dataset.src!
    delete image.dataset.src
    delete image.dataset.srcset
  }
}

export function HomeScenes() {
  useEffect(() => {
    const scenes = [...document.querySelectorAll<HTMLElement>('[data-scene]')]
    const active = new Set<HTMLElement>()
    let frame = 0
    const write = (scene: HTMLElement, name: string, value: number) => {
      const text = value.toFixed(4)
      if (scene.style.getPropertyValue(name) !== text) scene.style.setProperty(name, text)
    }
    const update = () => {
      frame = 0
      const height = window.innerHeight
      for (const scene of active) {
        const box = scene.getBoundingClientRect()
        write(scene, '--p', clamp(-box.top / Math.max(1, box.height - height)))
        write(scene, '--travel', clamp((height - box.top) / (height + box.height)))
      }
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          const scene = entry.target as HTMLElement
          if (entry.isIntersecting) {
            active.add(scene)
            reveal(scene)
          } else active.delete(scene)
        }
        schedule()
      },
      { rootMargin: '25% 0px' },
    )
    scenes.forEach(scene => observer.observe(scene))
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [])
  return null
}

'use client'

import { useEffect, useRef, useState } from 'react'

export function StardustBalance({ value }: { value: number }) {
  const previous = useRef(value)
  const [shown, setShown] = useState(value)

  useEffect(() => {
    const from = previous.current
    previous.current = value
    if (from === value || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value)
      return
    }
    const began = performance.now()
    let frame = requestAnimationFrame(function step(now) {
      const progress = Math.min(1, (now - began) / 520)
      setShown(Math.round(from + (value - from) * (1 - (1 - progress) ** 3)))
      if (progress < 1) frame = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(frame)
  }, [value])

  return <strong>{shown}</strong>
}

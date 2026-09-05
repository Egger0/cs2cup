'use client'

import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import type { SiteHeaderProps } from './SiteHeader'

export function SiteHeaderLoader({
  fallback,
  ...props
}: SiteHeaderProps & { fallback: ReactNode }) {
  const [Header, setHeader] = useState<ComponentType<SiteHeaderProps> | null>(null)

  useEffect(() => {
    let active = true
    let loaded: ComponentType<SiteHeaderProps> | null = null
    function enhance() {
      // Do not replace a native navigation control while someone is using it.
      if (!active || !loaded || document.activeElement?.closest('[data-basic-site-header]')) {
        return
      }
      setHeader(() => loaded)
      document.removeEventListener('focusin', enhance)
    }
    document.addEventListener('focusin', enhance)
    import('./SiteHeader')
      .then(module => {
        loaded = module.SiteHeader
        enhance()
      })
      .catch(() => {
        // Keep the server-rendered directory if the enhancement chunk is unavailable.
      })
    return () => {
      active = false
      document.removeEventListener('focusin', enhance)
    }
  }, [])

  return Header ? <Header {...props} /> : fallback
}

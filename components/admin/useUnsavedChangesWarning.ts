'use client'

import { useEffect } from 'react'

export function useUnsavedChangesWarning(dirty: boolean, message: string) {
  useEffect(() => {
    if (!dirty) return

    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = message
    }
    const confirmNavigation = (event: globalThis.MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }

      const target = event.target
      const link = target instanceof Element ? target.closest('a[href]') : null
      if (!(link instanceof HTMLAnchorElement) || link.target || link.download) return

      const destination = new URL(link.href, window.location.href)
      if (destination.href === window.location.href) return
      if (!window.confirm(message)) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }

    window.addEventListener('beforeunload', preventUnload)
    document.addEventListener('click', confirmNavigation, true)
    return () => {
      window.removeEventListener('beforeunload', preventUnload)
      document.removeEventListener('click', confirmNavigation, true)
    }
  }, [dirty, message])
}

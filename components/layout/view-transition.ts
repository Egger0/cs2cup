import type { MouseEvent } from 'react'

type ViewTransition = {
  finished: Promise<void>
  ready: Promise<void>
  updateCallbackDone: Promise<void>
}
type StartViewTransition = (callback: () => Promise<void>) => ViewTransition

function startViewTransition(): StartViewTransition | null {
  if (typeof document === 'undefined') return null
  const start = (document as Document & { startViewTransition?: StartViewTransition })
    .startViewTransition
  if (typeof start !== 'function') return null
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null
  return start.bind(document)
}

export function transitionTo(
  event: MouseEvent<HTMLAnchorElement>,
  href: string,
  push: (href: string) => void,
) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
  const start = startViewTransition()
  if (!start) return
  event.preventDefault()
  const target = new URL(href, location.href).pathname
  const transition = start(
    () =>
      new Promise(resolve => {
        const began = performance.now()
        const settle = () => {
          if (location.pathname === target || performance.now() - began > 2500) resolve()
          else setTimeout(settle, 16)
        }
        push(href)
        settle()
      }),
  )
  for (const step of [transition.ready, transition.updateCallbackDone, transition.finished])
    step.catch(() => {})
}

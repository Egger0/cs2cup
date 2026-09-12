'use client'

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import styles from './AccountPortal.module.css'

export function TrophyGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7.2 3.6h9.6v4.2a4.8 4.8 0 0 1-9.6 0z" />
      <path d="M7.2 5.1H4.6a2.4 2.4 0 0 0 2.6 3.9" />
      <path d="M16.8 5.1h2.6a2.4 2.4 0 0 1-2.6 3.9" />
      <path d="M12 12.6v2.6" />
      <path d="M9.9 15.2h4.2l.8 3.1H9.1z" />
      <path d="M7.8 20.4h8.4" />
    </svg>
  )
}

export function AccountPortal({
  href,
  label,
  hidden = false,
}: {
  href: string
  label: string
  hidden?: boolean
}) {
  const anchor = useRef<HTMLAnchorElement>(null)
  const [travel, setTravel] = useState<CSSProperties | null>(null)

  useEffect(() => {
    const clear = () => setTravel(null)
    window.addEventListener('pageshow', clear)
    window.addEventListener('popstate', clear)
    return () => {
      window.removeEventListener('pageshow', clear)
      window.removeEventListener('popstate', clear)
    }
  }, [])

  const enter = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
      return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const box = anchor.current?.getBoundingClientRect()
    if (!box) return

    event.preventDefault()
    const x = box.left + box.width / 2
    const y = box.top + box.height / 2
    const reach = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
    setTravel({
      '--portal-x': `${x}px`,
      '--portal-y': `${y}px`,
      '--portal-scale': String((reach / 23) * 1.08),
    } as CSSProperties)
    window.setTimeout(() => location.assign(href), 430)
  }

  return (
    <>
      <a
        ref={anchor}
        href={href}
        aria-label={label}
        title={label}
        className={hidden ? `${styles.portal} ${styles.hidden}` : styles.portal}
        aria-hidden={hidden || undefined}
        tabIndex={hidden ? -1 : undefined}
        onClick={enter}
      >
        <TrophyGlyph />
      </a>
      {travel
        ? createPortal(
            <div className={styles.veil} style={travel} aria-hidden="true">
              <span className={styles.disc} />
              <span className={styles.rising}>
                <TrophyGlyph />
              </span>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

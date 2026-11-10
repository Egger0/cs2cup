'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { isCurrentPath, PRIMARY_LINKS } from '@/lib/site-navigation'
import styles from './PrimaryNav.module.css'

export function PrimaryNav({ hidden = false }: { hidden?: boolean }) {
  const pathname = usePathname()
  const nav = useRef<HTMLElement>(null)
  const [lens, setLens] = useState<{ left: number; width: number } | null>(null)

  useLayoutEffect(() => {
    const measure = () => {
      const active = nav.current?.querySelector<HTMLElement>('[aria-current="page"]')
      setLens(active ? { left: active.offsetLeft, width: active.offsetWidth } : null)
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (nav.current) observer.observe(nav.current)
    return () => observer.disconnect()
  }, [pathname])

  return (
    <nav
      ref={nav}
      className={styles.nav}
      aria-label="主导航"
      aria-hidden={hidden || undefined}
      inert={hidden}
      style={
        lens
          ? ({ '--left': `${lens.left}px`, '--width': `${lens.width}px` } as CSSProperties)
          : undefined
      }
    >
      <span className={styles.lens} data-visible={lens ? '' : undefined} aria-hidden="true" />
      {PRIMARY_LINKS.map(link => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={isCurrentPath(pathname, link.href) ? 'page' : undefined}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  )
}

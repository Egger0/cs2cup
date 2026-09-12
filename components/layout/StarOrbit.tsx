'use client'

import Image from 'next/image'
import { useRef, type CSSProperties, type PointerEvent } from 'react'
import type { SiteNavLink } from './SiteHeaderFallback'
import styles from './StarOrbit.module.css'

const RINGS = [0.34, 0.62, 0.92]
const TICKS = [0, 45, 90, 135, 180, 225, 270, 315]
const TONES: Record<string, string> = {
  '/tournaments': '#6fb8e8',
  '/news': '#9bcaeb',
  '/archive': '#d8b169',
  '/games': '#b28a51',
  '/about': '#cfe8f8',
  '/guestbook': '#7fc4b8',
  '/lottery': '#f0757b',
  '/search': '#8fc8ef',
  '/me': '#6fb8e8',
  '/account': '#9bcaeb',
  '/account/security': '#cfe8f8',
  '/admin': '#d8b169',
}

const place = (radius: number, degrees: number, reach = 1) => {
  const angle = degrees * (Math.PI / 180)
  return [50 + 50 * radius * reach * Math.cos(angle), 50 + 30 * radius * reach * Math.sin(angle)]
}

function orbits(total: number) {
  const counts = [Math.min(3, total), Math.min(4, Math.max(0, total - 3)), Math.max(0, total - 7)]
  return counts.flatMap((count, ring) =>
    Array.from({ length: count }, (_, index) => {
      const degrees = (index / count) * 360 + ring * 52 - 64
      const [x, y] = place(RINGS[ring]!, degrees)
      return {
        ring,
        x,
        y,
        degrees: ((degrees % 360) + 360) % 360,
        depth: (Math.sin(degrees * (Math.PI / 180)) + 1) / 2,
      }
    }),
  )
}

export function StarOrbit({
  links,
  codes,
  lit,
  active,
  open,
}: {
  links: SiteNavLink[]
  codes: string[]
  lit: number
  active: number
  open: boolean
}) {
  const map = useRef<HTMLDivElement>(null)
  const spots = orbits(links.length)
  const focus = spots[lit]

  const tilt = (event: PointerEvent<HTMLDivElement>) => {
    const node = map.current
    if (!node || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const box = node.getBoundingClientRect()
    node.style.setProperty('--tilt-x', ((event.clientX - box.left) / box.width - 0.5).toFixed(3))
    node.style.setProperty('--tilt-y', ((event.clientY - box.top) / box.height - 0.5).toFixed(3))
  }
  const settle = () => {
    map.current?.style.setProperty('--tilt-x', '0')
    map.current?.style.setProperty('--tilt-y', '0')
  }

  return (
    <div
      ref={map}
      className={styles.map}
      data-open={open || undefined}
      aria-hidden="true"
      onPointerMove={tilt}
      onPointerLeave={settle}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {RINGS.map((radius, ring) => (
          <g key={radius} data-lit={focus?.ring === ring || undefined}>
            <ellipse className={styles.ring} cx="50" cy="50" rx={50 * radius} ry={30 * radius} />
            <ellipse className={styles.trail} cx="50" cy="50" rx={50 * radius} ry={30 * radius} />
            {TICKS.map(degrees => {
              const [x1, y1] = place(radius, degrees)
              const [x2, y2] = place(radius, degrees, 1.04)
              return <line key={degrees} className={styles.tick} x1={x1} y1={y1} x2={x2} y2={y2} />
            })}
          </g>
        ))}
        {spots.map((spot, index) => (
          <line
            key={links[index]!.href}
            className={styles.path}
            data-lit={index === lit || undefined}
            x1="50"
            y1="50"
            x2={spot.x}
            y2={spot.y}
          />
        ))}
      </svg>
      <span className={styles.star}>
        <Image src="/brand/club-mark.svg" alt="" width={72} height={72} />
      </span>
      <span className={styles.comet} />
      {spots.map((spot, index) => {
        const href = links[index]!.href
        return (
          <span
            key={href}
            className={styles.body}
            data-lit={index === lit || undefined}
            data-here={index === active || undefined}
            style={
              {
                left: `${spot.x}%`,
                top: `${spot.y}%`,
                '--depth': spot.depth.toFixed(2),
                '--tone': TONES[href] ?? '#b9c6cc',
              } as CSSProperties
            }
          >
            <i className={styles.dot}>
              {href === '/archive' ? <i className={styles.ringlet} /> : null}
              {href === '/tournaments' ? <i className={styles.moon} /> : null}
            </i>
            <b>{links[index]!.label}</b>
          </span>
        )
      })}
      {focus ? (
        <div className={styles.readout}>
          <span>ORBIT {String(focus.ring + 1).padStart(2, '0')}</span>
          <b>{codes[lit] ?? ''}</b>
          <span>
            {focus.degrees.toFixed(0)}° · {(RINGS[focus.ring]! * 2.4).toFixed(2)} AU
            {lit === active ? ' · 当前位置' : ''}
          </span>
        </div>
      ) : null}
    </div>
  )
}

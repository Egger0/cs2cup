'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SolarData } from './system'
import type { SolarRuntime } from './runtime'
import { bindChapters } from './scroll'
import { hardwareBackend, type Backend } from './hardware'
import { SolarPanel } from './SolarPanel'
import styles from './SolarSystem.module.css'
import focusStyles from './Focus.module.css'

const INPUTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const

export function SolarSystem({ data }: { data: SolarData }) {
  const host = useRef<HTMLDivElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const frontHost = useRef<HTMLDivElement>(null)
  const runtime = useRef<SolarRuntime | null>(null)
  const selection = useRef<string | null>(null)
  const path = useRef({ value: 0, keys: ['overview'] })
  const [selected, setSelected] = useState<string | null>(null)
  const [level, setLevel] = useState(0)
  const [fallback, setFallback] = useState(false)
  const select = useCallback((key: string | null, record = true) => {
    const active = document.activeElement
    if (active instanceof HTMLElement && active.dataset.solarKey && active.dataset.solarKey !== key)
      active.blur()
    selection.current = key
    setSelected(key)
    setLevel(0)
    runtime.current?.focus(key)
    runtime.current?.zoom(0)
    const base = `${location.pathname}${location.search}`
    if (record) history.replaceState(null, '', key ? `${base}#${encodeURIComponent(key)}` : base)
    else if (location.hash) history.replaceState(null, '', base)
  }, [])
  const zoom = useCallback((value: number) => {
    setLevel(value)
    runtime.current?.zoom(value)
  }, [])
  const back = useCallback(() => {
    const key = selection.current
    select(null)
    if (key)
      overlay.current
        ?.querySelector<HTMLButtonElement>(`[data-solar-key="${CSS.escape(key)}"]`)
        ?.focus({ preventScroll: true })
  }, [select])
  useEffect(() => {
    const controller = new AbortController()
    const element = host.current!
    const root = document.documentElement
    const syncHash = () => {
      let key = ''
      try {
        key = decodeURIComponent(location.hash.slice(1))
      } catch {
        return
      }
      const valid =
        key === 'club' ||
        data.games.some(game => game.slug === key) ||
        data.tournaments.some(event => `event-${event.slug}` === key)
      selection.current = valid ? key : null
      setSelected(selection.current)
      runtime.current?.focus(selection.current)
    }
    syncHash()
    const unbindChapters = bindChapters(overlay.current!, select, (value, keys) => {
      path.current = { value, keys }
      runtime.current?.progress(value, keys)
    })
    let chosen: Backend | null = null
    let front: { destroy: () => void } | null = null
    let companion = false
    let companionTimer = 0
    let gaveUp = false
    const startCompanion = () => {
      if (companion || !chosen || controller.signal.aborted || window.innerWidth < 700) return
      companion = true
      const backend = chosen
      void import('./front')
        .then(({ startFront }) => startFront(frontHost.current!, backend, controller.signal))
        .then(value => {
          if (controller.signal.aborted) value?.destroy()
          else front = value
        })
        .catch(() => {})
    }
    const watchdog = window.setTimeout(() => {
      if (runtime.current || controller.signal.aborted) return
      gaveUp = true
      setFallback(true)
    }, 15000)
    const thin = () => {
      const device = navigator as Navigator & {
        deviceMemory?: number
        connection?: { saveData?: boolean }
      }
      return (
        window.innerWidth < 700 &&
        (Boolean(device.connection?.saveData) || (device.deviceMemory ?? 8) <= 4)
      )
    }
    void (thin() ? Promise.resolve(null) : hardwareBackend())
      .then(async backend => {
        if (!backend) throw new Error('No usable 3D backend for this device')
        chosen = backend
        const { startSolar } = await import('./runtime')
        return startSolar(element, data, backend, select, zoom, controller.signal, () => {
          runtime.current?.destroy()
          runtime.current = null
          setFallback(true)
        })
      })
      .then(instance => {
        window.clearTimeout(watchdog)
        if (controller.signal.aborted || gaveUp) instance?.destroy()
        else {
          runtime.current = instance
          instance?.focus(selection.current)
          instance?.progress(path.current.value, path.current.keys)
          if (instance && chosen) {
            companionTimer = window.setTimeout(startCompanion, 2800)
            window.addEventListener('scroll', startCompanion, { once: true, passive: true })
          }
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setFallback(true)
      })
    const skip = () => {
      if (root.dataset.homeEntry !== 'intro') return
      root.dataset.homeEntry = 'skipped'
      runtime.current?.skipEntry()
    }
    const highlight = (event: Event) =>
      runtime.current?.hover((event as CustomEvent<string | null>).detail)
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && selection.current) back()
    }
    INPUTS.forEach(type => window.addEventListener(type, skip, { passive: true }))
    window.addEventListener('solar:hover', highlight)
    window.addEventListener('hashchange', syncHash)
    document.addEventListener('keydown', escape)
    return () => {
      window.clearTimeout(watchdog)
      window.clearTimeout(companionTimer)
      window.removeEventListener('scroll', startCompanion)
      unbindChapters()
      controller.abort()
      runtime.current?.destroy()
      runtime.current = null
      front?.destroy()
      INPUTS.forEach(type => window.removeEventListener(type, skip))
      window.removeEventListener('solar:hover', highlight)
      window.removeEventListener('hashchange', syncHash)
      document.removeEventListener('keydown', escape)
      root.dataset.homeEntry = 'instant'
    }
  }, [data, select, zoom, back])
  const hover = (key: string | null) => runtime.current?.hover(key)
  const bodies = [
    { key: 'club', label: '宁理电竞社', sub: 'EST. 2022', event: false, detail: '' },
    ...data.games.flatMap(game => [
      {
        key: game.slug,
        label: game.name,
        sub: game.nameEn ?? game.slug,
        event: false,
        detail: `${game.tagline ?? ''} · ${data.tournaments.filter(event => event.gameId === game.id).length} 届赛事`,
      },
      ...data.tournaments
        .filter(event => event.gameId === game.id)
        .sort((a, b) => a.edition - b.edition)
        .map(event => ({
          key: `event-${event.slug}`,
          label: `第 ${event.edition} 届 · ${event.title}`,
          sub: event.id === data.currentId ? '当前赛事' : event.season,
          event: true,
          detail: '',
        })),
    ]),
  ]
  return (
    <>
      <div ref={host} className={styles.stage} data-solar-stage />
      <div className={styles.veil} aria-hidden="true" />
      <div ref={frontHost} className={styles.front} aria-hidden="true" />
      <div
        ref={overlay}
        className={`${styles.overlay} ${focusStyles.fallback}`}
        data-solar-overlay
        data-solar-focus={selected ?? 'overview'}
        data-solar-fallback={fallback}
      >
        <nav
          className={styles.anchors}
          aria-label="探索社团星系"
          onFocusCapture={() => {
            if (overlay.current) overlay.current.dataset.focusAt = String(performance.now())
          }}
        >
          {bodies.map(body => (
            <button
              key={body.key}
              type="button"
              data-solar-key={body.key}
              data-solar-anchor={body.key}
              data-satellite={body.event}
              className={`${styles.anchor} ${focusStyles.anchor}`}
              aria-label={`${body.label} ${body.sub}`}
              aria-pressed={selected === body.key}
              onFocus={() => hover(body.key)}
              onBlur={() => hover(null)}
              onMouseEnter={() => hover(body.key)}
              onMouseLeave={() => hover(null)}
              onClick={() => select(body.key)}
            >
              <span>{body.label}</span>
              <small>{body.sub}</small>
              {body.detail && <span className={focusStyles.detail}>{body.detail}</span>}
            </button>
          ))}
        </nav>
        <div key={`${selected}:${level}`} className={focusStyles.transition} aria-hidden="true" />
        <SolarPanel data={data} selected={selected} level={level} onZoom={zoom} onBack={back} />
        <p className={styles.hint} data-visible={fallback || Boolean(selected)} data-solar-reserve>
          {fallback ? '星系静帧 · 所有入口均可使用' : '拖拽旋转 · 双指缩放 · Esc 返回'}
        </p>
      </div>
    </>
  )
}

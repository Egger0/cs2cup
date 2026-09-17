'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { hardwareBackend } from '@/components/home/solar/hardware'
import {
  SAND_KINDS,
  SAND_RISE,
  mapDataUrl,
  mapImageUrl,
  type DeltaMapData,
  type DeltaMapSummary,
  type SandKind,
  type SandPoint,
} from '@/lib/delta-sand'
import type { SandRuntime } from './runtime'
import { SandPanel } from './SandPanel'
import styles from './SandTable.module.css'

type Mode = 'loading' | 'solid' | 'flat'

const DEFAULT_KINDS: SandKind[] = ['exit', 'boss', 'key']

const spot = (x: number, y: number, extra?: CSSProperties) =>
  ({ '--fx': x, '--fy': y, ...extra }) as CSSProperties

export function SandTable({
  maps,
  initial,
  loadouts,
}: {
  maps: DeltaMapSummary[]
  initial: string
  loadouts: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const runtime = useRef<SandRuntime | null>(null)
  const cache = useRef(new Map<string, Promise<DeltaMapData>>())
  const [mapId, setMapId] = useState(initial)
  const [level, setLevel] = useState(0)
  const [kinds, setKinds] = useState<ReadonlySet<SandKind>>(() => new Set(DEFAULT_KINDS))
  const [data, setData] = useState<DeltaMapData | null>(null)
  const [mode, setMode] = useState<Mode>('loading')
  const [booted, setBooted] = useState(false)
  const [hovered, setHovered] = useState<SandPoint | null>(null)
  const [selected, setSelected] = useState<SandPoint | null>(null)
  const map = maps.find(entry => entry.id === mapId) ?? maps[0]!
  const current = data?.id === map.id ? data : null

  useEffect(() => {
    const controller = new AbortController()
    const give = () => {
      runtime.current?.destroy()
      runtime.current = null
      if (!controller.signal.aborted) setMode('flat')
    }
    const watchdog = window.setTimeout(() => !runtime.current && give(), 12000)
    const device = navigator as Navigator & {
      deviceMemory?: number
      connection?: { saveData?: boolean }
    }
    const thin =
      window.innerWidth < 700 &&
      (Boolean(device.connection?.saveData) || (device.deviceMemory ?? 8) <= 4)
    void (thin ? Promise.resolve(null) : hardwareBackend())
      .then(async backend => {
        if (!backend) throw new Error('No usable 3D backend')
        const { startSandTable } = await import('./runtime')
        return startSandTable(
          host.current!,
          overlay.current!,
          backend,
          {
            hover: setHovered,
            select: setSelected,
            ready: () => setMode('solid'),
            fail: give,
          },
          controller.signal,
        )
      })
      .then(instance => {
        window.clearTimeout(watchdog)
        if (controller.signal.aborted) return instance?.destroy()
        runtime.current = instance
        setBooted(Boolean(instance))
      })
      .catch(give)
    return () => {
      window.clearTimeout(watchdog)
      controller.abort()
      runtime.current?.destroy()
      runtime.current = null
    }
  }, [])

  useEffect(() => {
    let active = true
    const pending =
      cache.current.get(map.id) ??
      fetch(mapDataUrl(map.id)).then(response => {
        if (!response.ok) throw new Error(`Map data ${response.status}`)
        return response.json() as Promise<DeltaMapData>
      })
    cache.current.set(map.id, pending)
    pending.then(
      value => active && setData(value),
      () => cache.current.delete(map.id),
    )
    const url = new URL(location.href)
    url.searchParams.set('map', map.id)
    history.replaceState(history.state, '', url)
    return () => {
      active = false
    }
  }, [map.id])

  useEffect(() => {
    if (booted && current) void runtime.current?.show(current)
  }, [booted, current])

  useEffect(() => {
    if (booted && current) runtime.current?.level(current, level)
  }, [booted, current, level])

  useEffect(() => {
    runtime.current?.kinds(kinds)
  }, [booted, kinds])

  useEffect(() => {
    runtime.current?.relabel()
  }, [booted, current, hovered, selected])

  const choose = (id: string) => {
    if (id === map.id) return
    setMapId(id)
    setLevel(0)
    setSelected(null)
    setHovered(null)
  }
  const focusPoint = (point: SandPoint) => {
    setSelected(point)
    setKinds(previous => (previous.has(point[0]) ? previous : new Set([...previous, point[0]])))
    runtime.current?.focus(point[1], point[2], 1.3)
  }
  const points = current?.levels[level]?.points ?? []
  const pinned = selected ?? hovered

  return (
    <div className={styles.table} data-mode={mode}>
      <div className={styles.tabs} role="group" aria-label="烽火地带地图">
        {maps.map(entry => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={entry.id === map.id}
            className={styles.tab}
            onClick={() => choose(entry.id)}
          >
            <span>{entry.name}</span>
            <small>{entry.en}</small>
          </button>
        ))}
      </div>
      <div ref={host} className={styles.viewport} data-sand-stage>
        <img key={map.id} className={styles.poster} src={mapImageUrl(map.id, 1024)} alt="" />
        <div ref={overlay} className={styles.overlay}>
          {mode === 'flat'
            ? points
                .filter(point => kinds.has(point[0]))
                .map((point, index) => (
                  <button
                    key={index}
                    type="button"
                    className={styles.dot}
                    aria-label={`${SAND_KINDS[point[0]].label} ${point[4]}`}
                    style={spot(point[1], point[2], {
                      '--tone': SAND_KINDS[point[0]].color,
                    } as CSSProperties)}
                    onClick={() => setSelected(point)}
                  />
                ))
            : null}
          {(current?.regions ?? []).map(([name, x, y]) => (
            <button
              key={name}
              type="button"
              className={styles.region}
              data-sand-anchor
              data-x={x}
              data-y={y}
              style={spot(x, y)}
              onClick={() => runtime.current?.focus(x, y)}
            >
              {name}
            </button>
          ))}
          {pinned ? (
            <div
              className={styles.pin}
              data-sand-anchor
              data-priority="1"
              data-x={pinned[1]}
              data-y={pinned[2]}
              data-rise={SAND_RISE[pinned[0]] + 0.03}
              style={spot(pinned[1], pinned[2], {
                '--tone': SAND_KINDS[pinned[0]].color,
              } as CSSProperties)}
            >
              <small>{SAND_KINDS[pinned[0]].label}</small>
              <b>{pinned[4]}</b>
              {pinned[5] ? <span>{pinned[5]}</span> : null}
            </div>
          ) : null}
        </div>
        {mode === 'solid' ? (
          <div className={styles.controls}>
            <button type="button" aria-label="放大" onClick={() => runtime.current?.zoom(0.8)}>
              +
            </button>
            <button type="button" aria-label="缩小" onClick={() => runtime.current?.zoom(1.25)}>
              −
            </button>
            <button
              type="button"
              onClick={() => {
                setSelected(null)
                runtime.current?.overview()
              }}
            >
              全图
            </button>
          </div>
        ) : null}
        <p className={styles.hint} aria-live="polite">
          {mode === 'solid'
            ? '拖动旋转 · 点区域名飞过去 · 点一下沙盘后滚轮缩放'
            : mode === 'flat'
              ? '俯视图 · 这台设备没有开启 3D'
              : '沙盘展开中…'}
        </p>
      </div>
      <SandPanel
        map={map}
        data={current}
        level={level}
        kinds={kinds}
        selected={selected}
        loadouts={loadouts}
        onLevel={value => {
          setLevel(value)
          setSelected(null)
        }}
        onKinds={setKinds}
        onPoint={focusPoint}
        onClear={() => setSelected(null)}
      />
    </div>
  )
}

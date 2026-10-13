'use client'

import { useEffect, useRef, useState } from 'react'
import { hardwareBackend } from '@/components/home/solar/hardware'
import {
  NIGHT_LEVEL,
  SAND_DEFAULT_KINDS,
  mapDataUrl,
  type DeltaMapData,
  type DeltaMapSummary,
  type SandKind,
  type SandPoint,
} from '@/lib/delta-sand'
import type { SandPlan } from '@/lib/sand-routes'
import type { SandRuntime } from './runtime'
import { SandDrawer, type SandTab } from './SandDrawer'
import { SandLayers } from './SandLayers'
import { SandRail } from './SandRail'
import { SandStage, type SandMode } from './SandStage'
import styles from './SandTable.module.css'
import { useSandRoute } from './useSandRoute'

export function SandTable({
  maps,
  initial,
  loadouts,
  plans,
  shared,
}: {
  maps: DeltaMapSummary[]
  initial: string
  loadouts: string
  plans: SandPlan[]
  shared: SandPlan | null
}) {
  const host = useRef<HTMLDivElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const runtime = useRef<SandRuntime | null>(null)
  const cache = useRef(new Map<string, Promise<DeltaMapData>>())
  const ground = useRef<(x: number, y: number) => void>(() => {})
  const pickRef = useRef<(point: SandPoint | null) => void>(() => {})
  const [mapId, setMapId] = useState(initial)
  const [level, setLevel] = useState(shared?.level ?? 0)
  const [kinds, setKinds] = useState<ReadonlySet<SandKind>>(() => new Set(SAND_DEFAULT_KINDS))
  const [data, setData] = useState<DeltaMapData | null>(null)
  const [mode, setMode] = useState<SandMode>('loading')
  const [booted, setBooted] = useState(false)
  const [hovered, setHovered] = useState<SandPoint | null>(null)
  const [selected, setSelected] = useState<SandPoint | null>(null)
  const [building, setBuilding] = useState<number | null>(null)
  const [floor, setFloor] = useState<string | null>(null)
  const { route, routing, stop, plan, setRouting, setStop, edit, open } = useSandRoute(shared)
  const [tab, setTab] = useState<SandTab>('intel')
  const drawer = useRef<HTMLDivElement>(null)
  const map = maps.find(entry => entry.id === mapId) ?? maps[0]!
  const current = data?.id === map.id ? data : null

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const saved = Number(params.get('level'))
    const controller = new AbortController()
    queueMicrotask(() => {
      if (controller.signal.aborted) return
      if (saved > 0 && !params.has('plan')) setLevel(saved)
    })
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
            select: point => pickRef.current(point),
            ground: (x, y) => ground.current(x, y),
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
    return () => {
      active = false
    }
  }, [map.id])

  useEffect(() => {
    const url = new URL(location.href)
    url.searchParams.set('map', map.id)
    if (level) url.searchParams.set('level', String(level))
    else url.searchParams.delete('level')
    history.replaceState(history.state, '', url)
  }, [map.id, level])

  const levelName = map.levels[level] ?? ''
  useEffect(() => {
    if (booted && current) void runtime.current?.show(current)
  }, [booted, current])
  useEffect(() => {
    if (booted) runtime.current?.level(level)
  }, [booted, level])
  useEffect(() => runtime.current?.kinds(kinds), [booted, kinds])
  useEffect(() => runtime.current?.building(building, floor), [booted, current, building, floor])
  useEffect(() => runtime.current?.route(route), [booted, current, route])
  useEffect(() => runtime.current?.night(NIGHT_LEVEL.test(levelName)), [booted, levelName])
  useEffect(() => runtime.current?.relabel(), [booted, current, hovered, selected, building])
  useEffect(() => {
    const element = drawer.current
    if (!booted || !element) return
    const wide = matchMedia('(min-width: 1100px)')
    const sync = () => runtime.current?.inset(wide.matches ? element.offsetWidth + 24 : 0)
    const observer = new ResizeObserver(sync)
    observer.observe(element)
    wide.addEventListener('change', sync)
    return () => {
      observer.disconnect()
      wide.removeEventListener('change', sync)
    }
  }, [booted])

  const focusPoint = (point: SandPoint) => {
    setSelected(point)
    setKinds(previous => (previous.has(point[0]) ? previous : new Set([...previous, point[0]])))
    const [owner, code] = (point[6] ?? '').split(':')
    if (code) {
      setBuilding(Number(owner))
      setFloor(code)
      setTab('floors')
    } else {
      setBuilding(null)
      setFloor(null)
      runtime.current?.focus(point[1], point[2], 1.2)
    }
  }
  useEffect(() => {
    ground.current = (x, y) => {
      if (routing) edit(previous => [...previous, [x, y]])
      else runtime.current?.focus(x, y)
    }
    pickRef.current = point => {
      if (routing && point && !point[6]) edit(previous => [...previous, [point[1], point[2]]])
      else setSelected(point)
    }
  }, [routing, edit])
  const visit = (index: number, path = route) => {
    const point = path[index]
    if (!point) return
    setStop(index)
    setBuilding(null)
    setFloor(null)
    runtime.current?.focus(point[0], point[1], 1.1)
  }
  const reset = () => {
    setSelected(null)
    setHovered(null)
    setBuilding(null)
    setFloor(null)
  }

  const chooseMap = (id: string) => {
    if (id === map.id) return
    setMapId(id)
    setLevel(0)
    edit([])
    reset()
  }
  const points = current?.levels[level]?.points ?? []

  return (
    <div className={styles.table} data-mode={mode} data-routing={routing}>
      <SandStage
        host={host}
        overlay={overlay}
        data={current}
        mapId={map.id}
        mode={mode}
        level={level}
        kinds={kinds}
        pinned={hovered ?? selected}
        building={building}
        floor={floor}
        routing={routing}
        route={route}
        stop={stop}
        runtime={runtime}
        onPoint={focusPoint}
        onFloor={setFloor}
        onGround={(x, y) => ground.current(x, y)}
        onStop={visit}
        onOverview={() => {
          reset()
          runtime.current?.overview()
        }}
      >
        <SandRail maps={maps} current={map.id} onChoose={chooseMap} />
        <SandLayers points={points} kinds={kinds} onKinds={setKinds} />
      </SandStage>
      <div ref={drawer} className={styles.drawerSlot}>
        <SandDrawer
          map={map}
          data={current}
          level={level}
          tab={tab}
          selected={selected}
          building={building}
          floor={floor}
          routing={routing}
          route={route}
          stop={stop}
          plans={plans.filter(entry => entry.mapId === map.id)}
          plan={plan}
          loadouts={loadouts}
          onTab={setTab}
          onLevel={value => {
            setLevel(value)
            reset()
          }}
          onPoint={focusPoint}
          onRegion={(x, y) => {
            reset()
            runtime.current?.focus(x, y, 1.3)
          }}
          onBuilding={(index, code) => {
            setSelected(null)
            setBuilding(index)
            setFloor(code)
          }}
          onRouting={setRouting}
          onRoute={edit}
          onStop={visit}
          onPlan={entry => {
            setLevel(entry.level)
            setSelected(null)
            open(entry)
            visit(0, entry.waypoints)
          }}
          onClear={() => setSelected(null)}
        />
      </div>
    </div>
  )
}

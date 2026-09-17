export type SandKind = 'exit' | 'boss' | 'spawn' | 'key' | 'vault'

export const SAND_KINDS: Record<SandKind, { label: string; color: string }> = {
  exit: { label: '撤离点', color: '#7fe0a8' },
  boss: { label: '首领', color: '#f0757b' },
  key: { label: '钥匙房 · 密码房', color: '#d8b169' },
  vault: { label: '高价值容器', color: '#c3a6ff' },
  spawn: { label: '出生点', color: '#9fb3bb' },
}

export const SAND_RISE: Record<SandKind, number> = {
  exit: 0.2,
  boss: 0.16,
  key: 0.1,
  vault: 0.065,
  spawn: 0.05,
}

export interface DeltaMapSummary {
  id: string
  name: string
  en: string
  meters: number
  relief: number
  areas: string
  levels: string[]
  bosses: string
  exits: [label: string, note: string, only: string][]
}

export type SandPoint = [SandKind, number, number, number, string, string]

export interface DeltaMapData {
  id: string
  name: string
  meters: number
  relief: number
  grid: number
  height: string
  mask: string
  urban: string
  regions: [string, number, number, number][]
  levels: { name: string; points: SandPoint[] }[]
}

export const mapDataUrl = (id: string) => `/games/delta/maps/${id}.json`
export const mapPosterUrl = (id: string) => `/games/delta/maps/${id}.webp`

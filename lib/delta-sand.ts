export const SAND_KINDS = {
  exit: { label: '撤离点', color: '#7fe0a8', rise: 0.2 },
  boss: { label: '首领', color: '#f0757b', rise: 0.16 },
  key: { label: '钥匙房 · 密码房', color: '#d8b169', rise: 0.1 },
  vault: { label: '保险箱 · 高级储物', color: '#c3a6ff', rise: 0.065 },
  tech: { label: '电脑 · 服务器', color: '#8fc8ef', rise: 0.05 },
  arms: { label: '武器 · 弹药', color: '#e59866', rise: 0.045 },
  medical: { label: '医疗物资', color: '#f5a3c7', rise: 0.045 },
  task: { label: '行动 · 任务', color: '#ffd166', rise: 0.06 },
  special: { label: '特殊物资', color: '#6fd3c7', rise: 0.05 },
  stash: { label: '野外 · 藏匿', color: '#b8c77a', rise: 0.035 },
  bags: { label: '箱包 · 柜子', color: '#a8a39a', rise: 0.03 },
  spawn: { label: '出生点', color: '#9fb3bb', rise: 0.05 },
} as const

export type SandKind = keyof typeof SAND_KINDS

export const SAND_DEFAULT_KINDS: SandKind[] = ['exit', 'boss', 'key']

const ICONS: [SandKind, string[]][] = [
  ['boss', ['boss']],
  ['spawn', ['csd']],
  ['key', ['tyfk', 'mmf']],
  ['vault', ['bxx', 'xbxx', 'hkcwx', 'gjcwx']],
  ['tech', ['fwq', 'dn', 'dnjx']],
  ['arms', ['wqx', 'dwqx', 'dyx']],
  ['medical', ['ylb', 'ylwzd', 'ypbwx']],
  ['task', ['xdjqz', 'xdjqzgjz', 'my', 'cbt', 'qxj']],
  ['stash', ['nw', 'cnw', 'ywwzx', 'jbd', 'snc', 'ljx', 'mt', 'sjb']],
  ['bags', ['lxd', 'xlx', 'stx', 'dsb', 'kdx', 'dgjx', 'gjg', 'ctg', 'cwg', 'yf']],
]

const NAMED: [RegExp, string][] = [
  [/电脑/, 'dn'],
  [/储物柜/, 'cwg'],
]

type SandItem = { type?: string; icon?: string; catalog?: string; name?: string }

export function sandIconOf(item: SandItem) {
  const icon = item.icon?.replace(/^nav_/, '') ?? ''
  if (icon !== 'placeholder') return icon
  return NAMED.find(([pattern]) => pattern.test(item.name ?? ''))?.[1] ?? ''
}

export function sandKindOf(item: SandItem): SandKind | null {
  if (item.catalog === 'fish') return null
  if (item.type === 'retreat') return 'exit'
  const icon = sandIconOf(item)
  return ICONS.find(([, icons]) => icons.includes(icon))?.[0] ?? (icon ? 'special' : null)
}

export const NIGHT_LEVEL = /夜/

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

export type SandPoint = [
  kind: SandKind,
  x: number,
  y: number,
  label: string,
  note: string,
  icon: number,
  floor?: string,
  link?: number[],
]

export interface SandBuilding {
  name: string
  x: number
  y: number
  floors: string[]
  frames: [x: number, y: number, size: number][]
}

export interface DeltaMapData {
  id: string
  name: string
  meters: number
  relief: number
  grid: number
  detail: 2048 | 8192
  height: string
  mask: string
  regions: [string, number, number, number][]
  buildings: SandBuilding[]
  levels: { name: string; points: SandPoint[] }[]
}

export const floorKey = (building: number, floor: string) => `${building}:${floor}`

export const mapDataUrl = (id: string) => `/games/delta/maps/${id}.json`
export const mapImageUrl = (id: string, size: 256 | 1024 | 2048 | 4096) =>
  `/games/delta/maps/${id}-${size}.webp`
export const DETAIL = { side: 8192, tiles: 4 }
export const detailTileUrl = (id: string, col: number, row: number) =>
  `/games/delta/maps/${id}-d${col}${row}.webp`
export const ICON_ATLAS = { url: '/games/delta/maps/icons.webp', columns: 8, cell: 96 }
export const floorImageUrl = (id: string, building: number, floor: string) =>
  `/games/delta/maps/${id}-b${building}-${floor.toLowerCase()}.webp`

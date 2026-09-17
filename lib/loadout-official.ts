import { parsePastedLoadout, type LoadoutMode } from './delta-loadouts.ts'

const RENDER_HOST = 'https://playerhub.df.qq.com/'

export type Json = Record<string, unknown>

const STAT_KEYS = [
  ['recoil', 'recoil'],
  ['handling', 'control'],
  ['stability', 'stable'],
  ['hipfire', 'hipShot'],
  ['distance', 'shootDistance'],
] as const

export interface OfficialLoadout {
  officialId: number
  mode: LoadoutMode
  weapon: string
  code: string
  title: string
  note: string | null
  authorName: string
  authorChannel: string | null
  tags: string[]
  maps: string[]
  price: number | null
  stats: Record<string, number> | null
  baseStats: Record<string, number> | null
  renderUrl: string | null
  accessories: number[]
  applyCount: number
  officialLikes: number
  createdAt: number
}

export const record = (value: unknown): Json | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null
export const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
export const count = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
export const clip = (value: string, max: number) => [...value].slice(0, max).join('')
export const url = (value: unknown) => {
  const source = text(value)
  return source.startsWith(RENDER_HOST) ? source : null
}

function names(value: unknown, key: string) {
  return Array.isArray(value)
    ? value.map(item => clip(text(record(item)?.[key]), 12)).filter(Boolean)
    : []
}

export function stats(source: Json | null) {
  if (!source) return null
  const entries = STAT_KEYS.map(([key, field]) => [key, source[field]] as const)
  return entries.every(([, value]) => typeof value === 'number' && Number.isFinite(value))
    ? (Object.fromEntries(entries) as Record<string, number>)
    : null
}

function shanghaiMillis(value: unknown) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text(value))
  if (!match) return 0
  const [, y, mo, d, h, mi, s] = match.map(Number) as number[]
  return Date.UTC(y!, mo! - 1, d!, h! - 8, mi!, s!)
}

export function normalizeOfficialLoadout(raw: unknown): OfficialLoadout | null {
  const item = record(raw)
  const arms = record(item?.armsDetail)
  const officialId = item?.id
  if (!item || typeof officialId !== 'number' || !Number.isSafeInteger(officialId)) return null
  const pasted = parsePastedLoadout(text(item.solutionCode))
  const weapon = clip(text(arms?.objectName), 30)
  if (!pasted || !weapon) return null
  const properties = record(item.propertiesDetail)
  const origin = stats(record(properties?.origin))
  const change = stats(record(properties?.change))
  let accessories: number[] = []
  try {
    const parsed = JSON.parse(text(item.accessory) || '[]') as unknown
    if (Array.isArray(parsed)) {
      accessories = parsed
        .map(entry => record(entry)?.objectID)
        .filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id))
    }
  } catch {}
  const author = record(item.authorDetail)
  const note = clip(
    text(item.authorComment)
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    200,
  )
  return {
    officialId,
    mode: pasted.mode ?? 'operations',
    weapon,
    code: pasted.code,
    title: clip(text(item.name), 40) || weapon,
    note: note || null,
    authorName: clip(text(item.authorNickname), 40) || '官方精选',
    authorChannel: clip(text(author?.channel), 20) || null,
    tags: names(item.tagDetail, 'tagName').slice(0, 6),
    maps: names(item.mapDetail, 'mapName'),
    price: count(item.price) || null,
    stats:
      origin && change
        ? Object.fromEntries(STAT_KEYS.map(([key]) => [key, origin[key]! + change[key]!]))
        : null,
    baseStats: origin,
    renderUrl: url(item.previewPic),
    accessories,
    applyCount: count(item.applyNum),
    officialLikes: count(item.likeNum),
    createdAt: shanghaiMillis(item.created_at),
  }
}

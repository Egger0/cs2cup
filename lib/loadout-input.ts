import {
  LOADOUT_MODES,
  LOADOUT_STATS,
  LOADOUT_TAG_LIMIT,
  LOADOUT_TAGS,
  findWeapon,
  parsePastedLoadout,
  type LoadoutMode,
  type LoadoutStat,
} from './delta-loadouts.ts'
import { CONTROL_CHARACTER } from './registration-form.ts'

export type LoadoutField =
  | 'code'
  | 'mode'
  | 'weapon'
  | 'title'
  | 'note'
  | 'tags'
  | 'price'
  | 'stats'
export type LoadoutStats = Record<LoadoutStat, number>

export interface LoadoutInput {
  readonly code: string
  readonly mode: LoadoutMode
  readonly weapon: string
  readonly title: string
  readonly note: string | null
  readonly tags: readonly string[]
  readonly price: number | null
  readonly stats: LoadoutStats | null
}

const TEXT_LIMITS = { title: [1, 40], note: [0, 200] } as const

function text(raw: unknown, [min, max]: readonly [number, number]) {
  const value = typeof raw === 'string' ? raw.trim() : ''
  const length = [...value].length
  return length < min || length > max || CONTROL_CHARACTER.test(value) ? null : value
}

function integer(raw: unknown, max: number) {
  const value = typeof raw === 'string' && /^\d{1,8}$/.test(raw.trim()) ? Number(raw) : NaN
  return Number.isSafeInteger(value) && value <= max ? value : null
}

export function parseLoadoutInput(
  form: FormData,
): { ok: true; value: LoadoutInput } | { ok: false; field: LoadoutField } {
  const pasted = parsePastedLoadout(String(form.get('code') ?? ''))
  if (!pasted) return { ok: false, field: 'code' }
  const mode = String(form.get('mode') ?? '')
  if (!Object.hasOwn(LOADOUT_MODES, mode)) return { ok: false, field: 'mode' }
  const weapon = findWeapon(String(form.get('weapon') ?? ''))
  if (!weapon) return { ok: false, field: 'weapon' }
  const title = text(form.get('title'), TEXT_LIMITS.title)
  if (title === null) return { ok: false, field: 'title' }
  const note = text(form.get('note'), TEXT_LIMITS.note)
  if (note === null) return { ok: false, field: 'note' }

  const tags = [...new Set(form.getAll('tags').map(String))]
  if (
    tags.length > LOADOUT_TAG_LIMIT ||
    tags.some(tag => !(LOADOUT_TAGS as readonly string[]).includes(tag))
  ) {
    return { ok: false, field: 'tags' }
  }

  const rawPrice = String(form.get('price') ?? '').trim()
  let price: number | null = null
  if (mode === 'operations' && rawPrice) {
    const tenThousands = /^\d{1,4}(\.\d)?$/.test(rawPrice) ? Number(rawPrice) : NaN
    if (!(tenThousands > 0)) return { ok: false, field: 'price' }
    price = Math.round(tenThousands * 10_000)
  }

  const rawStats = LOADOUT_STATS.map(([key]) => [key, String(form.get(key) ?? '').trim()] as const)
  let stats: LoadoutStats | null = null
  if (rawStats.some(([, value]) => value)) {
    const parsed = rawStats.map(([key, value]) => [key, integer(value, 999)] as const)
    if (parsed.some(([, value]) => value === null)) return { ok: false, field: 'stats' }
    stats = Object.fromEntries(parsed) as LoadoutStats
  }

  return {
    ok: true,
    value: {
      code: pasted.code,
      mode: mode as LoadoutMode,
      weapon: weapon.name,
      title,
      note: note || null,
      tags,
      price,
      stats,
    },
  }
}

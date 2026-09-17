import { LOADOUT_STATS, type LoadoutMode } from '@/lib/delta-loadouts'
import type { LoadoutCode } from '@/lib/loadout-queries'
import type { LoadoutStats } from '@/lib/loadout-input'
import { LoadoutCard } from './LoadoutCards'

export function LoadoutPreview({
  slug,
  mode,
  weapon,
  code,
  title,
  tags,
  draft,
  shot,
}: {
  slug: string
  mode: LoadoutMode
  weapon: string
  code: string
  title: string
  tags: readonly string[]
  draft: Readonly<Record<string, string>>
  shot: string | null
}) {
  const statValues = LOADOUT_STATS.map(([key]) => [key, draft[key]?.trim() ?? ''] as const)
  const previewCode: LoadoutCode = {
    id: 0,
    mode,
    weapon,
    code: code,
    title: title.trim() || '给你的方案起个名字',
    note: draft.note?.trim() || null,
    tags,
    price:
      mode === 'operations' && Number(draft.price) > 0
        ? Math.round(Number(draft.price) * 10_000)
        : null,
    stats: statValues.every(([, value]) => /^\d{1,3}$/.test(value))
      ? (Object.fromEntries(statValues.map(([key, value]) => [key, Number(value)])) as LoadoutStats)
      : null,
    source: 'member',
    maps: [],
    accessories: [],
    baseStats: null,
    renderUrl: null,
    authorChannel: null,
    applyCount: 0,
    officialLikes: 0,
    shotKey: null,
    pendingShotKey: null,
    status: 'pending',
    copies: 0,
    reports: 0,
    likes: 0,
    comments: 0,
    authorName: '',
    authorHandle: null,
    gameSlug: slug,
    createdAt: 0,
  }

  return <LoadoutCard code={previewCode} preview={{ shot }} single />
}

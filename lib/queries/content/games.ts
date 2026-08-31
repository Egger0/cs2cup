import 'server-only'

import { requireAdmin } from '../../auth'
import {
  deletePrivateRows,
  insertPrivateRows,
  selectPrivateRows,
  updatePrivateRows,
} from '../../rdb'
import { type GameRow, toGame } from '../records'
import type { Game } from '../../types'
import { adminMutation } from './shared'

export async function adminListGames(): Promise<Game[]> {
  await requireAdmin()

  const rows = await selectPrivateRows<GameRow>('game', { order: 'sort_order.asc' })
  return rows.map(toGame)
}

export function adminSaveGame(id: number, values: Partial<Game>) {
  const payload: Record<string, unknown> = {}
  if (values.name !== undefined) payload.name = values.name
  if (values.nameEn !== undefined) payload.name_en = values.nameEn
  if (values.accentColor !== undefined) payload.accent_color = values.accentColor
  if (values.tagline !== undefined) payload.tagline = values.tagline
  if (values.description !== undefined) payload.description = values.description
  if (values.formatNote !== undefined) payload.format_note = values.formatNote
  if (values.sortOrder !== undefined) payload.sort_order = values.sortOrder
  if (values.active !== undefined) payload.active = values.active
  return adminMutation(() => updatePrivateRows('game', payload, { filters: { id: `eq.${id}` } }))
}

export function adminCreateGame(values: {
  slug: string
  name: string
  nameEn: string | null
  accentColor: string | null
  tagline: string | null
}) {
  return adminMutation(() =>
    insertPrivateRows('game', {
      slug: values.slug,
      name: values.name,
      name_en: values.nameEn,
      accent_color: values.accentColor,
      tagline: values.tagline,
      sort_order: 99,
      active: true,
    }),
  )
}

export function adminDeleteGame(id: number) {
  return adminMutation(() => deletePrivateRows('game', { filters: { id: `eq.${id}` } }))
}

import 'server-only'

import { cloudflareBindings } from './cloudflare-bindings'

export interface GraphicsPreset {
  id: number
  gameId: number
  title: string
  hardware: string
  target: string
  author: string
  note: string
  settings: string
}

export type GraphicsPresetInput = Omit<GraphicsPreset, 'id'>

const COLUMNS = 'id, game_id AS gameId, title, hardware, target, author, note, settings'

const values = (preset: GraphicsPresetInput) => [
  preset.gameId,
  preset.title,
  preset.hardware,
  preset.target,
  preset.author,
  preset.note,
  preset.settings,
]

export async function listGraphicsPresets(gameId?: number) {
  const { results } = await cloudflareBindings()
    .db.prepare(
      `SELECT ${COLUMNS} FROM graphics_preset WHERE ?1 IS NULL OR game_id = ?1
       ORDER BY game_id, created_at, id`,
    )
    .bind(gameId ?? null)
    .all<GraphicsPreset>()
  return results
}

export async function countGraphicsPresets(gameId: number) {
  const row = await cloudflareBindings()
    .db.prepare('SELECT COUNT(*) AS total FROM graphics_preset WHERE game_id = ?')
    .bind(gameId)
    .first<{ total: number }>()
  return row?.total ?? 0
}

export function insertGraphicsPreset(preset: GraphicsPresetInput) {
  return cloudflareBindings()
    .db.prepare(
      `INSERT INTO graphics_preset (game_id, title, hardware, target, author, note, settings)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(...values(preset))
    .run()
}

export function updateGraphicsPreset(id: number, preset: GraphicsPresetInput) {
  return cloudflareBindings()
    .db.prepare(
      `UPDATE graphics_preset
       SET game_id = ?, title = ?, hardware = ?, target = ?, author = ?, note = ?, settings = ?
       WHERE id = ?`,
    )
    .bind(...values(preset), id)
    .run()
}

export function deleteGraphicsPreset(id: number) {
  return cloudflareBindings().db.prepare('DELETE FROM graphics_preset WHERE id = ?').bind(id).run()
}

import type { Game, Post } from '../types'

export interface PostRow {
  id: number
  game_id: number | null
  slug: string
  title: string
  summary: string
  body: string
  published_at: string
  pinned: boolean
}

export interface GameRow {
  id: number
  slug: string
  name: string
  name_en: string | null
  accent_color: string | null
  tagline: string | null
  description: string | null
  format_note: string | null
  sort_order: number
  active: boolean
}

export function toPost(row: PostRow): Post {
  return {
    id: row.id,
    gameId: row.game_id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    body: row.body,
    publishedAt: row.published_at,
    pinned: row.pinned,
  }
}

export function toGame(row: GameRow): Game {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    nameEn: row.name_en,
    accentColor: row.accent_color,
    tagline: row.tagline,
    description: row.description,
    formatNote: row.format_note,
    sortOrder: row.sort_order,
    active: row.active,
  }
}

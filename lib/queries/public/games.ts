import 'server-only'
import { selectPublicRow, selectPublicRows } from '../../rdb'
import type { Game } from '../../types'
import { type GameRow, toGame } from '../records'

export async function listGames(): Promise<Game[]> {
  const rows = await selectPublicRows<GameRow>('game', {
    filters: { active: 'eq.1' },
    order: 'sort_order.asc',
  })
  return rows.map(toGame)
}

export async function getGame(slug: string): Promise<Game | null> {
  const row = await selectPublicRow<GameRow>('game', {
    filters: { slug: `eq.${slug}`, active: 'eq.1' },
  })
  return row ? toGame(row) : null
}

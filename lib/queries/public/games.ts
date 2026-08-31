import 'server-only'
import { selectPublicRow, selectPublicRows } from '../../rdb'
import type { Game } from '../../types'
import { type GameRow, toGame } from '../records'

export async function listGames(): Promise<Game[]> {
  const rows = await selectPublicRows<GameRow>('game', {
    order: 'sort_order.asc',
  })
  return rows.map(toGame)
}

export async function getGame(slug: string): Promise<Game | null> {
  const row = await selectPublicRow<GameRow>('game', {
    filters: { slug: `eq.${slug}` },
  })
  return row ? toGame(row) : null
}

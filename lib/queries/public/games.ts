import 'server-only'
import { selectPublicRow, selectPublicRows } from '../../rdb'
import type { Game } from '../../types'
import { GAME_SELECT, type GameRow, toGame } from '../records'

export async function listGames(): Promise<Game[]> {
  const rows = await selectPublicRows<GameRow>('game', {
    select: GAME_SELECT,
    order: 'sort_order.asc',
  })
  return rows.map(toGame)
}

export async function getGame(slug: string): Promise<Game | null> {
  const row = await selectPublicRow<GameRow>('game', {
    select: GAME_SELECT,
    filters: { slug: `eq.${slug}` },
  })
  return row ? toGame(row) : null
}

import { listGames, safely } from '@/lib/queries/public'

export const dynamic = 'force-dynamic'

export async function GET() {
  const game = (await safely(listGames, [])).find(entry => entry.loadoutCodes)
  return new Response(null, {
    status: 307,
    headers: { Location: game ? `/games/${game.slug}/loadouts` : '/games' },
  })
}

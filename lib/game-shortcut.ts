import { listGames, safely } from '@/lib/queries/public'

export async function redirectToGameFeature(feature: 'loadouts' | 'maps', search = '') {
  const game = (await safely(listGames, [])).find(entry => entry.loadoutCodes)
  return new Response(null, {
    status: 307,
    headers: { Location: game ? `/games/${game.slug}/${feature}${search}` : '/games' },
  })
}

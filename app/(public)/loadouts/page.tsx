import { notFound, redirect } from 'next/navigation'
import { listGames, safely } from '@/lib/queries/public'

export const dynamic = 'force-dynamic'

export default async function LoadoutsShortcut() {
  const game = (await safely(listGames, [])).find(entry => entry.loadoutCodes)
  if (!game) notFound()
  redirect(`/games/${game.slug}/loadouts`)
}

import 'server-only'

import { notFound } from 'next/navigation'
import {
  canCreateTournamentForGame,
  getCurrentUnifiedPlatformOwner,
  requireAdmin,
  requirePlatformConsole,
} from './auth'
import { adminListGames } from './queries/content/games'
import { getGame, listGames } from './queries/public/games'

export async function projectContentWorkspace() {
  const access = await requirePlatformConsole()
  const platformOwner = access.capabilities.includes('platform.configure')
  const allGames = platformOwner ? await adminListGames() : await listGames()
  const games = (
    await Promise.all(
      allGames.map(async game => ((await canCreateTournamentForGame(game.id)) ? game : null)),
    )
  ).filter((game): game is (typeof allGames)[number] => game !== null)
  if (!platformOwner && !games.length) notFound()
  return { games, platformOwner }
}

export async function requireProjectContentAccess(gameId: number | null) {
  if (gameId === null) await requireAdmin()
  else if (!(await canCreateTournamentForGame(gameId))) notFound()
}

export async function canManageSandRoutes() {
  if (await getCurrentUnifiedPlatformOwner()) return true
  const game = await getGame('Delta')
  return game ? canCreateTournamentForGame(game.id) : false
}

export async function requireSandRouteManagement() {
  if (!(await canManageSandRoutes())) notFound()
}

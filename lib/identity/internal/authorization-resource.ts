import { validPositiveId } from './contracts.ts'
import type { AuthorizationResource, ResolvedAuthorizationResource } from './policy.ts'

export interface AuthorizationConcreteResource {
  sql: string
  binding: number
  resolve(tournamentId: number | null, gameId: number | null): ResolvedAuthorizationResource | null
}

export function authorizationResourceCte(
  resource: Exclude<AuthorizationResource, { kind: 'platform' }>,
): AuthorizationConcreteResource {
  if (resource.kind === 'game') {
    return {
      sql: 'concrete_resource AS (SELECT NULL AS tournament_id, id AS game_id FROM game WHERE id = ?)',
      binding: resource.gameId,
      resolve: (_tournamentId, gameId) =>
        gameId === resource.gameId ? ({ kind: 'game', gameId } as const) : null,
    }
  }
  if (resource.kind === 'tournament') {
    return {
      sql: 'concrete_resource AS (SELECT id AS tournament_id, game_id FROM tournament WHERE id = ?)',
      binding: resource.tournamentId,
      resolve: tournamentId =>
        tournamentId === resource.tournamentId
          ? ({ kind: 'tournament', tournamentId } as const)
          : null,
    }
  }
  return {
    sql: `concrete_resource AS (
      SELECT team.tournament_id, tournament.game_id
      FROM team JOIN tournament ON tournament.id = team.tournament_id
      WHERE team.id = ?
    )`,
    binding: resource.registrationId,
    resolve: tournamentId =>
      validPositiveId(tournamentId ?? 0) && tournamentId !== null
        ? ({ kind: 'registration', registrationId: resource.registrationId, tournamentId } as const)
        : null,
  }
}

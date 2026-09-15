import 'server-only'

import type { IdentityDatabase } from '../identity/internal/contracts'

const DEFAULT_ROSTER_SIZE = 5

export async function tournamentRosterSize(
  database: IdentityDatabase,
  target: { readonly teamId: number } | { readonly tournamentSlug: string },
) {
  const row = await database
    .prepare(
      `SELECT game.roster_size AS rosterSize
       FROM tournament JOIN game ON game.id = tournament.game_id
       WHERE ${'teamId' in target ? 'tournament.id = (SELECT tournament_id FROM team WHERE id = ?)' : 'tournament.slug = ?'}`,
    )
    .bind('teamId' in target ? target.teamId : target.tournamentSlug)
    .first<{ rosterSize: number }>()
  return row?.rosterSize ?? DEFAULT_ROSTER_SIZE
}

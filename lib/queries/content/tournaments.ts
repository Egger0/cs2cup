import 'server-only'

import { requireAdmin } from '../../auth'
import {
  deletePrivateRows,
  insertPrivateRows,
  selectPrivateRows,
  updatePrivateRows,
} from '../../rdb'
import type { Tournament } from '../../types'
import type { TournamentUpdateValues } from '../../tournament-form'
import { adminMutation } from './shared'

interface TournamentRow {
  id: number
  slug: string
  title: string
  game_id: number | null
  season: string
  edition: number
  status: string
  format: string
  team_cap: number
  reg_deadline: string | null
  starts_at: string | null
  accent_color: string | null
  map_pool: Tournament['mapPool']
  rules: Tournament['rules']
  faqs: Tournament['faqs']
  hero_eyebrow: string
  hero_top: string
  hero_bottom: string
  lede: string
  champion_name: string | null
  champion_note: string | null
}

export async function adminListTournaments(): Promise<Tournament[]> {
  await requireAdmin()

  const rows = await selectPrivateRows<TournamentRow>('tournament', {
    order: 'season.desc,edition.desc',
  })
  return rows.map(row => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    gameId: row.game_id,
    gameSlug: null,
    gameName: null,
    season: row.season,
    edition: row.edition,
    status: row.status as Tournament['status'],
    format: row.format,
    teamCap: row.team_cap,
    regDeadline: row.reg_deadline,
    startsAt: row.starts_at,
    accentColor: row.accent_color,
    mapPool: row.map_pool ?? [],
    rules: row.rules ?? [],
    faqs: row.faqs ?? [],
    heroEyebrow: row.hero_eyebrow,
    heroTop: row.hero_top,
    heroBottom: row.hero_bottom,
    lede: row.lede,
    championName: row.champion_name,
    championNote: row.champion_note,
  }))
}

export function adminCreateTournament(values: {
  slug: string
  title: string
  gameId: number
  season: string
  edition: number
  teamCap: number
}) {
  return adminMutation(() =>
    insertPrivateRows('tournament', {
      slug: values.slug,
      title: values.title,
      game_id: values.gameId,
      season: values.season,
      edition: values.edition,
      team_cap: values.teamCap,
      status: 'draft',
      hero_bottom: values.title,
    }),
  )
}

export function adminDeleteTournament(id: number) {
  return adminMutation(() => deletePrivateRows('tournament', { filters: { id: `eq.${id}` } }))
}

export async function adminSaveTournament(id: number, values: TournamentUpdateValues) {
  const rows = await adminMutation(() =>
    updatePrivateRows('tournament', values, { filters: { id: `eq.${id}` } }),
  )
  return rows.length > 0
}

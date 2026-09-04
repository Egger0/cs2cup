import 'server-only'

import type { TeamStatus } from '../../types.ts'
import type { AuthenticatedAuthContext, IdentityDatabase } from '../internal/contracts.ts'
import type { AccountTournamentRegistration } from './types.ts'
import { requireActiveRegistrationSession, validRegistrationTime } from './shared.ts'

interface RegistrationRow {
  relationship: 'owner' | 'manager'
  team_id: number
  team_name: string
  team_tag: string
  captain: string
  contact: string
  dept: string | null
  note: string | null
  team_status: TeamStatus
  checked_in_at: string | null
  registered_at: string
  tournament_id: number
  tournament_slug: string
  tournament_title: string
  player_id: number | null
  player_nickname: string | null
  player_role: string | null
  player_is_substitute: number | null
  player_sort_order: number | null
}

function registrationEntries(rows: RegistrationRow[]) {
  const registrations = new Map<number, AccountTournamentRegistration>()
  for (const row of rows) {
    let registration = registrations.get(row.team_id)
    if (!registration) {
      registration = {
        relationship: row.relationship,
        tournament: {
          id: row.tournament_id,
          slug: row.tournament_slug,
          title: row.tournament_title,
        },
        team: {
          id: row.team_id,
          name: row.team_name,
          tag: row.team_tag,
          captain: row.captain,
          contact: row.contact,
          dept: row.dept,
          note: row.note,
          status: row.team_status,
          checkedInAt: row.checked_in_at,
          registeredAt: row.registered_at,
          members: [],
        },
      }
      registrations.set(row.team_id, registration)
    }
    if (row.player_id !== null && row.player_nickname !== null) {
      registration.team.members.push({
        id: row.player_id,
        nickname: row.player_nickname,
        role: row.player_role,
        isSubstitute: row.player_is_substitute === 1,
        sortOrder: row.player_sort_order ?? 0,
      })
    }
  }
  return [...registrations.values()]
}

export async function listAccountTournamentRegistrations(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  now = Date.now(),
) {
  if (!validRegistrationTime(now)) throw new TypeError('Invalid registration list time')
  await requireActiveRegistrationSession(database, context, now)
  const rows = (
    await database
      .prepare(
        `SELECT membership.relationship,
                team.id AS team_id, team.name AS team_name, team.tag AS team_tag,
                team.captain, team.contact, team.dept, team.note,
                team.status AS team_status, team.checked_in_at,
                team.created_at AS registered_at,
                tournament.id AS tournament_id, tournament.slug AS tournament_slug,
                tournament.title AS tournament_title,
                player.id AS player_id, player.nickname AS player_nickname,
                player.role AS player_role, player.is_substitute AS player_is_substitute,
                player.sort_order AS player_sort_order
         FROM identity_registration_membership AS membership
         JOIN team ON team.id = membership.team_id
         JOIN tournament ON tournament.id = team.tournament_id
         LEFT JOIN player ON player.team_id = team.id
         WHERE membership.account_id = ? AND membership.revoked_at IS NULL
           AND membership.granted_at <= ?
           AND (membership.expires_at IS NULL OR membership.expires_at > ?)
           AND membership.id = (
             SELECT preferred.id FROM identity_registration_membership AS preferred
             WHERE preferred.team_id = membership.team_id
               AND preferred.account_id = membership.account_id
               AND preferred.revoked_at IS NULL AND preferred.granted_at <= ?
               AND (preferred.expires_at IS NULL OR preferred.expires_at > ?)
             ORDER BY CASE preferred.relationship WHEN 'owner' THEN 0 ELSE 1 END,
                      preferred.granted_at DESC LIMIT 1
           )
         ORDER BY team.created_at DESC, team.id DESC,
                  player.sort_order ASC, player.id ASC`,
      )
      .bind(context.account.id, now, now, now, now)
      .all<RegistrationRow>()
  ).results
  return registrationEntries(rows)
}

export async function accountRegistrationRelationship(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  teamId: number,
  now = Date.now(),
) {
  if (!Number.isSafeInteger(teamId) || teamId <= 0 || !validRegistrationTime(now)) return null
  await requireActiveRegistrationSession(database, context, now)
  return database
    .prepare(
      `SELECT id, relationship FROM identity_registration_membership
       WHERE team_id = ? AND account_id = ? AND revoked_at IS NULL
         AND granted_at <= ? AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY CASE relationship WHEN 'owner' THEN 0 ELSE 1 END LIMIT 1`,
    )
    .bind(teamId, context.account.id, now, now)
    .first<{ id: string; relationship: 'owner' | 'manager' }>()
}

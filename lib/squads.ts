import 'server-only'

import type { IdentityDatabase } from './identity/internal/contracts.ts'
import { createOpaqueToken } from './opaque-token.ts'
import { CONTROL_CHARACTER } from './registration-form.ts'

export const SQUAD_PENDING_INVITATIONS = 6

export interface SquadMember {
  readonly accountId: string
  readonly displayName: string
  readonly handle: string | null
  readonly captain: boolean
}

export interface Squad {
  readonly id: string
  readonly name: string
  readonly tag: string
  readonly game: { readonly id: number; readonly slug: string; readonly name: string }
  readonly rosterSize: number
  readonly captainAccountId: string
  readonly members: SquadMember[]
  readonly invitations: { readonly id: string; readonly displayName: string }[]
}

export interface SquadInvitation {
  readonly id: string
  readonly squadName: string
  readonly squadTag: string
  readonly gameName: string
  readonly inviterName: string
  readonly openSeats: number
}

type Failure<Reason extends string> = { readonly ok: false; readonly reason: Reason }

function constraint(error: unknown) {
  return error instanceof Error ? error.message : ''
}

export function parseSquadIdentity(name: unknown, tag: unknown) {
  const cleanName = typeof name === 'string' ? name.trim() : ''
  const cleanTag = typeof tag === 'string' ? tag.trim().toUpperCase() : ''
  if ([...cleanName].length < 1 || [...cleanName].length > 20 || CONTROL_CHARACTER.test(cleanName))
    return null
  if (!/^[A-Z0-9]{2,5}$/.test(cleanTag)) return null
  return { name: cleanName, tag: cleanTag }
}

export async function listSquadGames(database: IdentityDatabase) {
  const { results } = await database
    .prepare(
      `SELECT id, slug, name, roster_size AS rosterSize FROM game
       WHERE active = 1 ORDER BY sort_order ASC, id ASC`,
    )
    .bind()
    .all<{ id: number; slug: string; name: string; rosterSize: number }>()
  return results
}

export async function accountSquads(
  database: IdentityDatabase,
  accountId: string,
): Promise<Squad[]> {
  const { results } = await database
    .prepare(
      `SELECT squad.id, squad.name, squad.tag, squad.captain_account_id AS captainAccountId,
              game.id AS gameId, game.slug AS gameSlug, game.name AS gameName,
              game.roster_size AS rosterSize,
              member.account_id AS memberId, account.display_name AS memberName,
              account.public_handle AS memberHandle,
              (SELECT json_group_array(json_object('id', invitation.id, 'displayName', invitee.display_name))
               FROM squad_invitation AS invitation
               JOIN identity_account AS invitee ON invitee.id = invitation.account_id
               WHERE invitation.squad_id = squad.id AND invitation.status = 'pending'
                 AND squad.captain_account_id = ?) AS invitations
       FROM squad_member AS mine
       JOIN squad ON squad.id = mine.squad_id
       JOIN game ON game.id = squad.game_id
       JOIN squad_member AS member ON member.squad_id = squad.id
       JOIN identity_account AS account ON account.id = member.account_id
       WHERE mine.account_id = ?
       ORDER BY squad.created_at DESC, member.account_id = squad.captain_account_id DESC,
                member.joined_at ASC`,
    )
    .bind(accountId, accountId)
    .all<{
      id: string
      name: string
      tag: string
      captainAccountId: string
      gameId: number
      gameSlug: string
      gameName: string
      rosterSize: number
      memberId: string
      memberName: string
      memberHandle: string | null
      invitations: string | null
    }>()
  const squads = new Map<string, Squad>()
  for (const row of results) {
    const squad = squads.get(row.id) ?? {
      id: row.id,
      name: row.name,
      tag: row.tag,
      game: { id: row.gameId, slug: row.gameSlug, name: row.gameName },
      rosterSize: row.rosterSize,
      captainAccountId: row.captainAccountId,
      members: [],
      invitations: JSON.parse(row.invitations ?? '[]') as Squad['invitations'],
    }
    squad.members.push({
      accountId: row.memberId,
      displayName: row.memberName,
      handle: row.memberHandle,
      captain: row.memberId === row.captainAccountId,
    })
    squads.set(row.id, squad)
  }
  return [...squads.values()]
}

export async function incomingSquadInvitations(
  database: IdentityDatabase,
  accountId: string,
): Promise<SquadInvitation[]> {
  const { results } = await database
    .prepare(
      `SELECT invitation.id, squad.name AS squadName, squad.tag AS squadTag,
              game.name AS gameName, inviter.display_name AS inviterName,
              game.roster_size - (SELECT COUNT(*) FROM squad_member WHERE squad_id = squad.id)
                AS openSeats
       FROM squad_invitation AS invitation
       JOIN squad ON squad.id = invitation.squad_id
       JOIN game ON game.id = squad.game_id
       JOIN identity_account AS inviter ON inviter.id = invitation.invited_by_account_id
       WHERE invitation.account_id = ? AND invitation.status = 'pending'
       ORDER BY invitation.created_at DESC`,
    )
    .bind(accountId)
    .all<SquadInvitation>()
  return results
}

export async function createSquad(
  database: IdentityDatabase,
  accountId: string,
  input: { gameId: number; name: string; tag: string },
  now: number,
): Promise<{ ok: true; squadId: string } | Failure<'taken' | 'already_in_squad' | 'unavailable'>> {
  const squadId = createOpaqueToken()
  try {
    await database.batch([
      database
        .prepare(
          `INSERT INTO squad (id, game_id, name, tag, captain_account_id, created_at)
           SELECT ?, id, ?, ?, ?, ? FROM game WHERE id = ? AND active = 1`,
        )
        .bind(squadId, input.name, input.tag, accountId, now, input.gameId),
      database
        .prepare(
          `INSERT INTO squad_member (squad_id, game_id, account_id, joined_at)
           SELECT id, game_id, captain_account_id, created_at FROM squad WHERE id = ?`,
        )
        .bind(squadId),
    ])
  } catch (error) {
    const message = constraint(error)
    if (/squad_member\.game_id/.test(message)) return { ok: false, reason: 'already_in_squad' }
    if (/squad\.game_id/.test(message)) return { ok: false, reason: 'taken' }
    throw error
  }
  const created = await database
    .prepare('SELECT 1 AS present FROM squad WHERE id = ?')
    .bind(squadId)
    .first<{ present: number }>()
  return created ? { ok: true, squadId } : { ok: false, reason: 'unavailable' }
}

export async function inviteToSquad(
  database: IdentityDatabase,
  input: { captainAccountId: string; squadId: string; identifier: string },
  now: number,
): Promise<
  | { ok: true; displayName: string }
  | Failure<'not_captain' | 'not_found' | 'self' | 'taken' | 'full' | 'pending' | 'limit'>
> {
  const identifier = input.identifier.trim().replace(/^@/, '').toLowerCase()
  const row = await database
    .prepare(
      `SELECT squad.game_id AS gameId,
              game.roster_size - (SELECT COUNT(*) FROM squad_member WHERE squad_id = squad.id)
                AS openSeats,
              (SELECT COUNT(*) FROM squad_invitation
               WHERE squad_id = squad.id AND status = 'pending') AS pending,
              target.id AS targetId, target.display_name AS targetName,
              EXISTS (SELECT 1 FROM squad_member
                      WHERE game_id = squad.game_id AND account_id = target.id) AS targetTaken,
              EXISTS (SELECT 1 FROM squad_invitation WHERE squad_id = squad.id
                      AND account_id = target.id AND status = 'pending') AS targetPending
       FROM squad JOIN game ON game.id = squad.game_id
       LEFT JOIN identity_account AS target ON target.status = 'active' AND (
         target.public_handle = ? OR target.id = (
           SELECT account_id FROM identity_password_credential WHERE username = ? LIMIT 1
         )
       )
       WHERE squad.id = ? AND squad.captain_account_id = ?`,
    )
    .bind(identifier, identifier, input.squadId, input.captainAccountId)
    .first<{
      gameId: number
      openSeats: number
      pending: number
      targetId: string | null
      targetName: string | null
      targetTaken: number
      targetPending: number
    }>()
  if (!row) return { ok: false, reason: 'not_captain' }
  if (!row.targetId || !row.targetName) return { ok: false, reason: 'not_found' }
  if (row.targetId === input.captainAccountId) return { ok: false, reason: 'self' }
  if (row.targetTaken) return { ok: false, reason: 'taken' }
  if (row.openSeats < 1) return { ok: false, reason: 'full' }
  if (row.targetPending) return { ok: false, reason: 'pending' }
  if (row.pending >= SQUAD_PENDING_INVITATIONS) return { ok: false, reason: 'limit' }
  try {
    await database
      .prepare(
        `INSERT INTO squad_invitation (id, squad_id, account_id, invited_by_account_id, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(createOpaqueToken(), input.squadId, row.targetId, input.captainAccountId, now)
      .run()
  } catch (error) {
    if (/UNIQUE constraint failed/.test(constraint(error))) return { ok: false, reason: 'pending' }
    throw error
  }
  return { ok: true, displayName: row.targetName }
}

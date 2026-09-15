import 'server-only'

import type { IdentityDatabase } from './identity/internal/contracts.ts'

type Result<Reason extends string> =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: Reason }

async function invitationStatus(database: IdentityDatabase, invitationId: string) {
  const row = await database
    .prepare('SELECT status FROM squad_invitation WHERE id = ?')
    .bind(invitationId)
    .first<{ status: string }>()
  return row?.status ?? null
}

export async function respondToSquadInvitation(
  database: IdentityDatabase,
  input: { accountId: string; invitationId: string; accept: boolean },
  now: number,
): Promise<Result<'not_found' | 'full' | 'already_in_squad'>> {
  const { accountId, invitationId } = input
  if (!input.accept) {
    await database
      .prepare(
        `UPDATE squad_invitation SET status = 'declined', responded_at = ?
         WHERE id = ? AND account_id = ? AND status = 'pending'`,
      )
      .bind(now, invitationId, accountId)
      .run()
    return (await invitationStatus(database, invitationId)) === 'declined'
      ? { ok: true }
      : { ok: false, reason: 'not_found' }
  }
  try {
    await database.batch([
      database
        .prepare(
          `INSERT INTO squad_member (squad_id, game_id, account_id, joined_at)
           SELECT squad.id, squad.game_id, invitation.account_id, ?
           FROM squad_invitation AS invitation JOIN squad ON squad.id = invitation.squad_id
           WHERE invitation.id = ? AND invitation.account_id = ? AND invitation.status = 'pending'`,
        )
        .bind(now, invitationId, accountId),
      database
        .prepare(
          `UPDATE squad_invitation SET status = 'accepted', responded_at = ?
           WHERE id = ? AND account_id = ? AND status = 'pending' AND EXISTS (
             SELECT 1 FROM squad_member
             WHERE squad_id = squad_invitation.squad_id AND account_id = squad_invitation.account_id
           )`,
        )
        .bind(now, invitationId, accountId),
    ])
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/squad is full/.test(message)) return { ok: false, reason: 'full' }
    if (/UNIQUE constraint failed/.test(message)) return { ok: false, reason: 'already_in_squad' }
    throw error
  }
  return (await invitationStatus(database, invitationId)) === 'accepted'
    ? { ok: true }
    : { ok: false, reason: 'not_found' }
}

export async function revokeSquadInvitation(
  database: IdentityDatabase,
  input: { captainAccountId: string; invitationId: string },
  now: number,
): Promise<Result<'not_found'>> {
  await database
    .prepare(
      `UPDATE squad_invitation SET status = 'revoked', responded_at = ?
       WHERE id = ? AND status = 'pending' AND squad_id IN (
         SELECT id FROM squad WHERE captain_account_id = ?
       )`,
    )
    .bind(now, input.invitationId, input.captainAccountId)
    .run()
  return (await invitationStatus(database, input.invitationId)) === 'revoked'
    ? { ok: true }
    : { ok: false, reason: 'not_found' }
}

async function memberPresent(database: IdentityDatabase, squadId: string, accountId: string) {
  const row = await database
    .prepare('SELECT 1 AS present FROM squad_member WHERE squad_id = ? AND account_id = ?')
    .bind(squadId, accountId)
    .first<{ present: number }>()
  return row !== null
}

export async function removeSquadMember(
  database: IdentityDatabase,
  input: { actorAccountId: string; squadId: string; memberAccountId: string },
): Promise<Result<'not_allowed'>> {
  const { actorAccountId, squadId, memberAccountId } = input
  await database
    .prepare(
      `DELETE FROM squad_member
       WHERE squad_id = ? AND account_id = ?
         AND account_id != (SELECT captain_account_id FROM squad WHERE id = squad_member.squad_id)
         AND (account_id = ? OR EXISTS (
           SELECT 1 FROM squad WHERE id = squad_member.squad_id AND captain_account_id = ?
         ))`,
    )
    .bind(squadId, memberAccountId, actorAccountId, actorAccountId)
    .run()
  return (await memberPresent(database, squadId, memberAccountId))
    ? { ok: false, reason: 'not_allowed' }
    : { ok: true }
}

export async function disbandSquad(
  database: IdentityDatabase,
  input: { captainAccountId: string; squadId: string },
): Promise<Result<'not_captain'>> {
  await database
    .prepare('DELETE FROM squad WHERE id = ? AND captain_account_id = ?')
    .bind(input.squadId, input.captainAccountId)
    .run()
  const row = await database
    .prepare('SELECT 1 AS present FROM squad WHERE id = ?')
    .bind(input.squadId)
    .first<{ present: number }>()
  return row ? { ok: false, reason: 'not_captain' } : { ok: true }
}

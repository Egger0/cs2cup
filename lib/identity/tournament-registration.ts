import 'server-only'

import { createOpaqueToken } from '../opaque-token.ts'
import type { RegistrationFormValues } from '../registration-form.ts'
import type { AuthenticatedAuthContext, IdentityDatabase } from './internal/contracts.ts'

export type TournamentRegistrationResult =
  | { readonly ok: true; readonly relationshipId: string; readonly teamId: number }
  | { readonly ok: false; readonly reason: 'authorization_changed' | 'registration_changed' }

export interface TournamentRegistrationInput {
  readonly tournamentId: number
  readonly team: RegistrationFormValues
  readonly managementTokenHash: string
  readonly fingerprint: string
  readonly now?: number
}

const TEAM_LOOKUP = `SELECT candidate.id FROM team AS candidate
  WHERE candidate.tournament_id = ? AND candidate.tag = ?
    AND candidate.management_token_hash = ?`

const CURRENT_MEMBER_SESSION = `
  SELECT 1 FROM identity_account AS account
  JOIN identity_session AS session
    ON session.id = ? AND session.account_id = account.id
  JOIN identity_membership AS membership
    ON membership.account_id = account.id
  WHERE account.id = ? AND account.status = 'active'
    AND account.security_version = session.security_version
    AND session.revoked_at IS NULL AND session.recovery_restricted = 0
    AND session.created_at <= ? AND session.last_seen_at <= ?
    AND session.authenticated_at <= ?
    AND session.idle_expires_at > ? AND session.absolute_expires_at > ?
    AND session.auth_method != 'bootstrap'
    AND (session.recovery_verified_at IS NULL OR session.recovery_verified_at <= ?)
    AND (session.phishing_resistant_at IS NULL OR session.phishing_resistant_at <= ?)
    AND (session.auth_method != 'password' OR EXISTS (
      SELECT 1 FROM identity_password_credential AS password
      WHERE password.id = session.password_credential_id
        AND password.account_id = session.account_id AND password.status = 'active'
    ))
    AND (session.auth_method != 'passkey' OR EXISTS (
      SELECT 1 FROM identity_passkey_credential AS credential
      JOIN identity_auth_intent AS intent ON intent.id = session.passkey_auth_intent_id
      WHERE credential.credential_id = session.authenticator_credential_id
        AND credential.account_id = session.account_id AND credential.status = 'active'
        AND intent.purpose IN ('passkey_sign_in', 'passkey_step_up')
        AND (intent.expected_account_id IS NULL OR intent.expected_account_id = session.account_id)
        AND intent.consumed_at = session.authenticated_at
        AND intent.completion_result_type = 'passkey_credential'
        AND intent.completion_result_ref = credential.credential_id
        AND session.phishing_resistant_at = intent.consumed_at
    ))
    AND membership.status = 'approved' AND membership.revoked_at IS NULL
    AND membership.approved_at <= ?`

function memberSessionBindings(context: AuthenticatedAuthContext, now: number) {
  return [context.session.id, context.account.id, now, now, now, now, now, now, now, now]
}

async function currentMemberSession(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  now: number,
) {
  const result = await database
    .prepare(`${CURRENT_MEMBER_SESSION} LIMIT 1`)
    .bind(...memberSessionBindings(context, now))
    .first<{ 1: number }>()
  return result !== null
}

function validInput(input: TournamentRegistrationInput, now: number) {
  return (
    Number.isSafeInteger(input.tournamentId) &&
    input.tournamentId > 0 &&
    /^[0-9a-f]{64}$/.test(input.managementTokenHash) &&
    typeof input.fingerprint === 'string' &&
    input.fingerprint.length > 0 &&
    Number.isSafeInteger(now) &&
    now >= 0
  )
}

export async function createApprovedTournamentRegistration(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  input: TournamentRegistrationInput,
): Promise<TournamentRegistrationResult> {
  const now = input.now ?? Date.now()
  if (!validInput(input, now)) throw new TypeError('Invalid tournament registration command')
  const relationshipId = createOpaqueToken()
  const team = input.team
  const locator = [input.tournamentId, team.tag, input.managementTokenHash] as const
  const statements = [
    database
      .prepare(
        `INSERT INTO team
          (tournament_id,name,tag,captain,contact,dept,note,status,management_token_hash)
         SELECT tournament.id,?,?,?,?,?,?,'pending',? FROM tournament
         WHERE tournament.id = ? AND tournament.status IN ('registration','postponed')
           AND (tournament.reg_deadline IS NULL
             OR unixepoch(tournament.reg_deadline) > unixepoch('now'))
           AND EXISTS (${CURRENT_MEMBER_SESSION})`,
      )
      .bind(
        team.name,
        team.tag,
        team.captain,
        team.contact,
        team.dept || null,
        team.note || null,
        input.managementTokenHash,
        input.tournamentId,
        ...memberSessionBindings(context, now),
      ),
    ...team.players.map((player, index) =>
      database
        .prepare(
          `INSERT INTO player (team_id,nickname,is_substitute,sort_order)
           SELECT id,?,?,? FROM team
           WHERE tournament_id = ? AND tag = ? AND management_token_hash = ?`,
        )
        .bind(player.nickname, player.substitute ? 1 : 0, index + 1, ...locator),
    ),
    database
      .prepare(
        `INSERT INTO registration_attempt (fingerprint,tournament_id,accepted)
         SELECT ?,tournament_id,1 FROM team
         WHERE tournament_id = ? AND tag = ? AND management_token_hash = ?`,
      )
      .bind(input.fingerprint, ...locator),
    database
      .prepare(
        `INSERT INTO identity_registration_membership
          (id, team_id, account_id, relationship, granted_by_account_id,
           grant_reason, granted_at)
         VALUES (?, (
           ${TEAM_LOOKUP} AND EXISTS (${CURRENT_MEMBER_SESSION})
         ), ?, 'owner', ?, 'Self-created tournament registration', ?)`,
      )
      .bind(
        relationshipId,
        ...locator,
        ...memberSessionBindings(context, now),
        context.account.id,
        context.account.id,
        now,
      ),
    database
      .prepare(
        `DELETE FROM identity_registration_draft
         WHERE account_id = ? AND tournament_id = ? AND EXISTS (
           SELECT 1 FROM identity_registration_membership
           WHERE id = ? AND account_id = ? AND team_id IN (
             SELECT id FROM team WHERE tournament_id = ? AND management_token_hash = ?
           )
         )`,
      )
      .bind(
        context.account.id,
        input.tournamentId,
        relationshipId,
        context.account.id,
        input.tournamentId,
        input.managementTokenHash,
      ),
    database
      .prepare(
        `UPDATE team SET management_token_hash = NULL
         WHERE tournament_id = ? AND management_token_hash = ? AND EXISTS (
           SELECT 1 FROM identity_registration_membership
           WHERE id = ? AND team_id = team.id AND account_id = ?
             AND relationship = 'owner' AND revoked_at IS NULL
         )`,
      )
      .bind(input.tournamentId, input.managementTokenHash, relationshipId, context.account.id),
  ]

  try {
    await database.batch(statements)
  } catch (error) {
    if (!(await currentMemberSession(database, context, now))) {
      return { ok: false, reason: 'authorization_changed' }
    }
    if (
      error instanceof Error &&
      /identity_registration_membership\.team_id|foreign key constraint/i.test(error.message)
    ) {
      return { ok: false, reason: 'registration_changed' }
    }
    throw error
  }
  const relationship = await database
    .prepare(
      `SELECT team_id FROM identity_registration_membership
       WHERE id = ? AND account_id = ? AND relationship = 'owner' AND revoked_at IS NULL`,
    )
    .bind(relationshipId, context.account.id)
    .first<{ team_id: number }>()
  if (!relationship) return { ok: false, reason: 'registration_changed' }
  return { ok: true, relationshipId, teamId: relationship.team_id }
}

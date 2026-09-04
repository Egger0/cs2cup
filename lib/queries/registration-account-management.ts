import 'server-only'

import { authorize } from '../identity/internal/authorization'
import type { AuthenticatedAuthContext, IdentityDatabase } from '../identity/internal/contracts'
import {
  mapRegistration,
  REGISTRATION_SELECT,
  RegistrationManagementError,
  registrationPlayers,
  type AccountManagedRegistration,
  type AccountManagedRegistrationRow,
  type ManagedRegistrationValues,
} from './registration-management-model'
import { saveRegistrationWithAccess } from './registration-management-write'

function authorizationError(reason: string) {
  return new RegistrationManagementError(
    reason === 'assurance_required' ||
      reason === 'recovery_restricted' ||
      reason === 'session_invalid'
      ? 'reauth_required'
      : 'forbidden',
  )
}

async function accountRegistrationRow(
  database: IdentityDatabase,
  accountId: string,
  teamId: number,
  now: number,
) {
  return database
    .prepare(
      `SELECT registration.*, membership.id AS access_id,
              membership.revision AS access_revision, membership.relationship
       FROM (${REGISTRATION_SELECT}) AS registration
       JOIN identity_registration_membership AS membership
         ON membership.team_id = registration.id
       WHERE registration.id = ? AND membership.account_id = ?
         AND membership.revoked_at IS NULL AND membership.granted_at <= ?
         AND (membership.expires_at IS NULL OR membership.expires_at > ?)
       ORDER BY CASE membership.relationship WHEN 'owner' THEN 0 ELSE 1 END LIMIT 1`,
    )
    .bind(teamId, accountId, now, now)
    .first<AccountManagedRegistrationRow>()
}

async function authorizedAccountRegistrationRow(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  teamId: number,
  capability: 'registration.view' | 'registration.edit',
  now: number,
) {
  if (!Number.isSafeInteger(teamId) || teamId <= 0) {
    throw new RegistrationManagementError('forbidden')
  }
  const decision = await authorize(
    database,
    context,
    capability,
    { kind: 'registration', registrationId: teamId },
    undefined,
    now,
  )
  if (!decision.ok) throw authorizationError(decision.reason)
  const row = await accountRegistrationRow(database, context.account.id, teamId, now)
  if (!row) throw new RegistrationManagementError('forbidden')
  return row
}

export async function getAccountManagedRegistration(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  teamId: number,
  now = Date.now(),
) {
  const row = await authorizedAccountRegistrationRow(
    database,
    context,
    teamId,
    'registration.view',
    now,
  )
  return {
    ...mapRegistration(row, await registrationPlayers(database, row.id)),
    relationship: row.relationship,
  } satisfies AccountManagedRegistration
}

export async function saveAccountManagedRegistration(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  teamId: number,
  expectedRevision: number,
  values: ManagedRegistrationValues,
  now = Date.now(),
) {
  const row = await authorizedAccountRegistrationRow(
    database,
    context,
    teamId,
    'registration.edit',
    now,
  )
  const bindings = [row.id, row.access_id, context.account.id, row.access_revision, now, now]
  const guard = `team.id = ? AND EXISTS (
    SELECT 1 FROM identity_registration_membership AS access
    WHERE access.id = ? AND access.team_id = team.id AND access.account_id = ?
      AND access.revision = ? AND access.revoked_at IS NULL AND access.granted_at <= ?
      AND (access.expires_at IS NULL OR access.expires_at > ?)
      AND access.relationship IN ('owner', 'manager')
  )`
  return saveRegistrationWithAccess(database, row, expectedRevision, values, {
    guard,
    bindings,
    missingCode: 'forbidden',
    legacy: false,
    reload: () => accountRegistrationRow(database, context.account.id, teamId, now),
  })
}

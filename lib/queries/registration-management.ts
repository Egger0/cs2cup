import 'server-only'

import { cloudflareBindings } from '../cloudflare-bindings'
import type { IdentityDatabase } from '../identity/internal/contracts'
import { hashRegistrationToken } from '../registration-access'
import {
  mapRegistration,
  RegistrationManagementError,
  registrationPlayers,
  registrationRowByHash,
  SLUG_PATTERN,
  type ManagedRegistrationRow,
  type ManagedRegistrationValues,
} from './registration-management-model'
import { saveRegistrationWithAccess } from './registration-management-write'

export * from './registration-account-management'
export type {
  AccountManagedRegistration,
  ManagedRegistration,
  ManagedRegistrationTeam,
  ManagedRegistrationValues,
} from './registration-management-model'
export { RegistrationManagementError } from './registration-management-model'

const TOKEN_ACCESS_GUARD =
  "team.id = ? AND team.management_token_hash = ? AND EXISTS (SELECT 1 FROM tournament WHERE tournament.id = team.tournament_id AND tournament.slug = ?) AND NOT EXISTS (SELECT 1 FROM identity_registration_membership AS owner WHERE owner.team_id = team.id AND owner.relationship = 'owner' AND owner.revoked_at IS NULL)"

async function registrationRow(slug: string, token: string) {
  if (!SLUG_PATTERN.test(slug)) return null
  const tokenHash = await hashRegistrationToken(token)
  return tokenHash ? registrationRowByHash(cloudflareBindings().db, slug, tokenHash) : null
}

export async function getManagedRegistration(slug: string, token: string) {
  const row = await registrationRow(slug, token)
  if (!row) return null
  return mapRegistration(row, await registrationPlayers(cloudflareBindings().db, row.id), true)
}

function managedGuardBindings(row: ManagedRegistrationRow, tokenHash: string, slug: string) {
  return [row.id, tokenHash, slug]
}

export async function saveManagedRegistration(
  slug: string,
  token: string,
  expectedRevision: number,
  values: ManagedRegistrationValues,
) {
  if (!SLUG_PATTERN.test(slug)) throw new RegistrationManagementError('invalid_token')
  const tokenHash = await hashRegistrationToken(token)
  if (!tokenHash) throw new RegistrationManagementError('invalid_token')
  const database: IdentityDatabase = cloudflareBindings().db
  const row = await registrationRowByHash(database, slug, tokenHash)
  if (!row) throw new RegistrationManagementError('invalid_token')
  return saveRegistrationWithAccess(database, row, expectedRevision, values, {
    guard: TOKEN_ACCESS_GUARD,
    bindings: managedGuardBindings(row, tokenHash, slug),
    missingCode: 'invalid_token',
    legacy: true,
    reload: () => registrationRowByHash(database, slug, tokenHash),
  })
}

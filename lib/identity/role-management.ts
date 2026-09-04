import 'server-only'

import { createOpaqueToken } from '../opaque-token.ts'
import {
  OPAQUE_ID,
  validPositiveId,
  type AuthenticatedAuthContext,
  type IdentityDatabase,
} from './internal/contracts.ts'
import {
  ACTIVE_ROLE_OPERATOR,
  roleAccessFailure,
  roleMutationAuditStatement,
  roleMutationRecorded,
  roleOperation,
  roleOperatorProof,
  type RoleOperationOptions,
} from './internal/role-operator.ts'
import { isCanonicalStoredUsername, normalizeUsername } from './internal/username-policy.ts'
import { GRANTABLE_IDENTITY_ROLES, type ManagedIdentityRole } from './role-contract.ts'

export { GRANTABLE_IDENTITY_ROLES, MANAGED_IDENTITY_ROLES } from './role-contract.ts'
export type { ManagedIdentityRole, ManagedRoleAssignment } from './role-contract.ts'
export { listManagedRoleAssignments } from './role-management-list.ts'

export async function grantManagedRole(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  input: {
    readonly username: string
    readonly role: ManagedIdentityRole
    readonly tournamentId: number | null
    readonly reason: string
  },
  options: RoleOperationOptions = {},
) {
  const current = roleOperation(options)
  const username = normalizeUsername(input.username)
  const reason = input.reason.trim()
  const platformRole = input.role === 'identity_reviewer'
  if (
    !isCanonicalStoredUsername(username) ||
    !GRANTABLE_IDENTITY_ROLES.some(role => role === input.role) ||
    (platformRole ? input.tournamentId !== null : !validPositiveId(input.tournamentId ?? 0)) ||
    reason.length < 3 ||
    reason.length > 500
  ) {
    return { ok: false, reason: 'invalid_input' } as const
  }
  const denied = await roleAccessFailure(database, context, current.now)
  if (denied) return { ok: false, reason: denied } as const
  const operatorProof = roleOperatorProof(context, current.now)
  if (!operatorProof) return { ok: false, reason: 'session_invalid' } as const
  const target = await database
    .prepare(
      `SELECT account.id, account.display_name
       FROM identity_password_credential AS password
       JOIN identity_account AS account ON account.id = password.account_id
       WHERE password.username = ? AND password.status = 'active' AND account.status = 'active'
       LIMIT 1`,
    )
    .bind(username)
    .first<{ id: string; display_name: string }>()
  if (!target) return { ok: false, reason: 'not_found' } as const
  if (!platformRole) {
    const tournament = await database
      .prepare('SELECT 1 AS present FROM tournament WHERE id = ? LIMIT 1')
      .bind(input.tournamentId)
      .first<{ present: number }>()
    if (!tournament) return { ok: false, reason: 'not_found' } as const
  }
  const scopeType = platformRole ? 'platform' : 'tournament'
  const id = createOpaqueToken()
  const writeNonce = createOpaqueToken()
  const mutation = {
    action: 'granted' as const,
    assignmentId: id,
    assignmentNonce: writeNonce,
    assignmentRevision: 0,
    targetAccountId: target.id,
    role: input.role,
    tournamentId: input.tournamentId,
    reason,
    context,
    correlationId: current.correlationId,
    now: current.now,
  }
  try {
    await database.batch([
      database
        .prepare(
          `INSERT INTO identity_role_assignment
            (id, account_id, role, scope_type, scope_tournament_id,
             granted_by_account_id, grant_reason, granted_at, write_nonce)
           SELECT ?, target.id, ?, ?, ?, ?, ?, ?, ?
           FROM identity_password_credential AS password
           JOIN identity_account AS target ON target.id = password.account_id
           WHERE password.username = ? AND password.status = 'active'
             AND target.id = ? AND target.status = 'active'
             ${platformRole ? '' : 'AND EXISTS (SELECT 1 FROM tournament WHERE id = ?)'}
             AND ${ACTIVE_ROLE_OPERATOR}`,
        )
        .bind(
          id,
          input.role,
          scopeType,
          input.tournamentId,
          context.account.id,
          reason,
          current.now,
          writeNonce,
          username,
          target.id,
          ...(!platformRole ? [input.tournamentId] : []),
          ...operatorProof,
        ),
      await roleMutationAuditStatement(database, mutation),
    ])
  } catch (error) {
    if (error instanceof Error && /(?:role assignment|constraint|unique)/i.test(error.message)) {
      return { ok: false, reason: 'conflict' } as const
    }
    throw error
  }
  if (!(await roleMutationRecorded(database, mutation))) {
    return { ok: false, reason: 'conflict' } as const
  }
  return { ok: true, assignmentId: id } as const
}

export async function revokeManagedRole(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  input: { readonly assignmentId: string; readonly revision: number; readonly reason: string },
  options: RoleOperationOptions = {},
) {
  const current = roleOperation(options)
  const reason = input.reason.trim()
  if (
    !OPAQUE_ID.test(input.assignmentId) ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 0 ||
    reason.length < 3 ||
    reason.length > 500
  ) {
    return { ok: false, reason: 'invalid_input' } as const
  }
  const denied = await roleAccessFailure(database, context, current.now)
  if (denied) return { ok: false, reason: denied } as const
  const operatorProof = roleOperatorProof(context, current.now)
  if (!operatorProof) return { ok: false, reason: 'session_invalid' } as const
  const role = await database
    .prepare(
      `SELECT id, account_id, role, scope_tournament_id, revision
       FROM identity_role_assignment WHERE id = ?
         AND role IN ('identity_reviewer','organizer','referee','check_in_operator')
         AND revoked_at IS NULL LIMIT 1`,
    )
    .bind(input.assignmentId)
    .first<{
      id: string
      account_id: string
      role: ManagedIdentityRole
      scope_tournament_id: number | null
      revision: number
    }>()
  if (!role) return { ok: false, reason: 'not_found' } as const
  if (role.revision !== input.revision) return { ok: false, reason: 'conflict' } as const
  const writeNonce = createOpaqueToken()
  const mutation = {
    action: 'revoked' as const,
    assignmentId: role.id,
    assignmentNonce: writeNonce,
    assignmentRevision: input.revision + 1,
    targetAccountId: role.account_id,
    role: role.role,
    tournamentId: role.scope_tournament_id,
    reason,
    context,
    correlationId: current.correlationId,
    now: current.now,
  }
  try {
    await database.batch([
      database
        .prepare(
          `UPDATE identity_role_assignment SET revoked_by_account_id = ?, revoke_reason = ?,
                revoked_at = ?, revision = ?, write_nonce = ?
           WHERE id = ? AND revision = ? AND revoked_at IS NULL
             AND role IN ('identity_reviewer','organizer','referee','check_in_operator')
             AND ${ACTIVE_ROLE_OPERATOR}`,
        )
        .bind(
          context.account.id,
          reason,
          current.now,
          input.revision + 1,
          writeNonce,
          role.id,
          input.revision,
          ...operatorProof,
        ),
      await roleMutationAuditStatement(database, mutation),
    ])
  } catch (error) {
    if (error instanceof Error && /(?:role assignment|constraint|revision)/i.test(error.message))
      return { ok: false, reason: 'conflict' } as const
    throw error
  }
  if (!(await roleMutationRecorded(database, mutation))) {
    return { ok: false, reason: 'conflict' } as const
  }
  return { ok: true } as const
}

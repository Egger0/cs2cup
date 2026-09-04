import 'server-only'

import type { AuthenticatedAuthContext, IdentityDatabase } from './internal/contracts.ts'
import {
  roleAccessFailure,
  roleOperation,
  type RoleOperationOptions,
} from './internal/role-operator.ts'
import type { ManagedIdentityRole, ManagedRoleAssignment } from './role-contract.ts'

const ACTIVE_MANAGED_ROLES = `assignment.role IN
  ('identity_reviewer','organizer','referee','check_in_operator')
  AND assignment.revoked_at IS NULL AND assignment.granted_at <= ?
  AND (assignment.expires_at IS NULL OR assignment.expires_at > ?)`

export async function listManagedRoleAssignments(
  database: IdentityDatabase,
  context: AuthenticatedAuthContext,
  options: RoleOperationOptions & { readonly limit?: number; readonly offset?: number } = {},
) {
  const current = roleOperation(options)
  const limit = options.limit ?? 50
  const offset = options.offset ?? 0
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  ) {
    return { ok: false, reason: 'invalid_input' } as const
  }
  const denied = await roleAccessFailure(database, context, current.now)
  if (denied) return { ok: false, reason: denied } as const
  const [count, roles, tournaments] = await Promise.all([
    database
      .prepare(
        `SELECT COUNT(*) AS total FROM identity_role_assignment AS assignment
        WHERE ${ACTIVE_MANAGED_ROLES}`,
      )
      .bind(current.now, current.now)
      .first<{ total: number }>(),
    database
      .prepare(
        `SELECT assignment.id, assignment.revision, assignment.account_id,
                account.display_name, password.username, assignment.role,
                assignment.scope_tournament_id, tournament.title AS tournament_title,
                assignment.granted_at
         FROM identity_role_assignment AS assignment
         JOIN identity_account AS account ON account.id = assignment.account_id
         LEFT JOIN identity_password_credential AS password
           ON password.account_id = account.id AND password.status = 'active'
         LEFT JOIN tournament ON tournament.id = assignment.scope_tournament_id
         WHERE ${ACTIVE_MANAGED_ROLES}
         ORDER BY CASE assignment.role WHEN 'identity_reviewer' THEN 0 ELSE 1 END,
                  account.display_name, assignment.id LIMIT ? OFFSET ?`,
      )
      .bind(current.now, current.now, limit, offset)
      .all<{
        id: string
        revision: number
        account_id: string
        display_name: string
        username: string | null
        role: ManagedIdentityRole
        scope_tournament_id: number | null
        tournament_title: string | null
        granted_at: number
      }>(),
    database
      .prepare(
        `SELECT id, title FROM tournament
         WHERE status != 'finished' ORDER BY edition DESC, id DESC LIMIT 100`,
      )
      .bind()
      .all<{ id: number; title: string }>(),
  ])
  const total = Number(count?.total) || 0
  return {
    ok: true,
    total,
    assignments: roles.results.map(
      row =>
        ({
          id: row.id,
          revision: row.revision,
          accountId: row.account_id,
          displayName: row.display_name,
          username: row.username,
          role: row.role,
          tournamentId: row.scope_tournament_id,
          tournamentTitle: row.tournament_title,
          grantedAt: row.granted_at,
        }) satisfies ManagedRoleAssignment,
    ),
    tournaments: tournaments.results,
    pagination: {
      offset,
      limit,
      hasPrevious: offset > 0,
      hasNext: offset + roles.results.length < total,
    },
  } as const
}

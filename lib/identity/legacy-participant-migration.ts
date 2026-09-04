import 'server-only'

import { createOpaqueToken, hashOpaqueToken } from '../opaque-token.ts'
import type { IdentityDatabase, IdentityStatement } from './internal/contracts.ts'
import {
  legacyParticipantCopyStatements,
  legacyParticipantMapProofStatement,
  legacyParticipantSnapshot,
  type LegacyCredentialRow,
  type LegacyEntryRow,
  type LegacyRoleRow,
} from './internal/legacy-participant-copy.ts'

interface LegacyPrincipalRow {
  principal_id: string
  webauthn_user_handle: string
  display_name: string | null
  captain_name: string | null
  created_at: string
}

const CREDENTIAL_LIMIT = 20
const ENTRY_LIMIT = 200
const ROLE_LIMIT = 100

function sourceCreatedAt(value: string, now: number) {
  const parsed = Date.parse(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= now ? parsed : now
}

function displayName(source: LegacyPrincipalRow) {
  const candidate = (source.display_name ?? source.captain_name ?? '赛事账号').trim()
  return candidate.length > 80 ? candidate.slice(0, 80).trim() : candidate
}

async function completionEvent(
  database: IdentityDatabase,
  input: {
    accountId: string
    principalId: string
    proofNonce: string
    credentials: number
    registrations: number
    roles: number
    now: number
  },
) {
  const eventId = createOpaqueToken()
  const correlationId = createOpaqueToken()
  const eventType = 'identity.legacy_participant.migrated'
  return database
    .prepare(
      `INSERT INTO identity_security_event
        (id, event_type, severity, actor_type, actor_account_id, target_account_id,
         actor_session_id, resource_type, resource_id, request_correlation_id,
         deduplication_key, details_json, retention_class, created_at)
       VALUES (
         CASE WHEN EXISTS (
           SELECT 1 FROM identity_legacy_subject_map AS migrated
           JOIN identity_cutover AS cutover ON cutover.account_id = migrated.account_id
           WHERE migrated.subject_type = 'participant_principal'
             AND migrated.subject_id = ? AND migrated.account_id = ?
             AND migrated.write_nonce = ? AND cutover.phase = 3
             AND NOT EXISTS (
               SELECT 1 FROM participant_session WHERE principal_id = migrated.subject_id
             )
         ) THEN ? ELSE NULL END,
         ?, 'info', 'system', NULL, ?, NULL, 'account', ?, ?, ?, ?,
         'access_control', ?
       )`,
    )
    .bind(
      input.principalId,
      input.accountId,
      input.proofNonce,
      eventId,
      eventType,
      input.accountId,
      input.accountId,
      correlationId,
      await hashOpaqueToken(`${eventType}\0${input.principalId}\0${input.proofNonce}`),
      JSON.stringify({
        credentials: input.credentials,
        registrations: input.registrations,
        roles: input.roles,
      }),
      input.now,
    )
}

export type PreparedLegacyParticipantMigration =
  | { readonly kind: 'mapped'; readonly accountId: string }
  | {
      readonly kind: 'prepared'
      readonly accountId: string
      readonly principalId: string
      readonly userHandle: string
      readonly credential: LegacyCredentialRow
      readonly statements: readonly IdentityStatement[]
    }

export async function prepareLegacyParticipantMigration(
  database: IdentityDatabase,
  credentialId: string,
  now = Date.now(),
): Promise<PreparedLegacyParticipantMigration | null> {
  const source = await database
    .prepare(
      `SELECT principal.id AS principal_id, principal.webauthn_user_handle,
              profile.display_name,
              (SELECT team.captain FROM tournament_entry_owner AS owner
               JOIN team ON team.id = owner.team_id
               WHERE owner.principal_id = principal.id ORDER BY team.id LIMIT 1) AS captain_name,
              principal.created_at
       FROM participant_passkey_credential AS credential
       JOIN participant_principal AS principal ON principal.id = credential.principal_id
       LEFT JOIN participant_profile AS profile ON profile.principal_id = principal.id
       WHERE credential.credential_id = ? LIMIT 1`,
    )
    .bind(credentialId)
    .first<LegacyPrincipalRow>()
  if (!source) return null

  const mapped = await database
    .prepare(
      `SELECT account_id FROM identity_legacy_subject_map
       WHERE subject_type = 'participant_principal' AND subject_id = ? LIMIT 1`,
    )
    .bind(source.principal_id)
    .first<{ account_id: string }>()
  // A mapping is the authority boundary. Retrying migration must never replay stale
  // legacy grants or credentials over later changes made in the unified system.
  if (mapped) return { kind: 'mapped', accountId: mapped.account_id }

  const [occupied, credentialRows, entryRows, roleRows] = await Promise.all([
    database
      .prepare('SELECT id FROM identity_account WHERE webauthn_user_handle = ? LIMIT 1')
      .bind(source.webauthn_user_handle)
      .first<{ id: string }>(),
    database
      .prepare(
        `SELECT credential_id, public_key, counter, transports_json, device_type, backed_up,
                revision, created_at, last_used_at
         FROM participant_passkey_credential WHERE principal_id = ?
         ORDER BY created_at, credential_id LIMIT ?`,
      )
      .bind(source.principal_id, CREDENTIAL_LIMIT + 1)
      .all<LegacyCredentialRow>(),
    database
      .prepare(
        `SELECT team_id FROM tournament_entry_owner WHERE principal_id = ?
         ORDER BY team_id LIMIT ?`,
      )
      .bind(source.principal_id, ENTRY_LIMIT + 1)
      .all<LegacyEntryRow>(),
    database
      .prepare(
        `SELECT tournament_id, role, granted_at, expires_at
         FROM tournament_role_assignment
         WHERE principal_id = ? AND revoked_at IS NULL AND granted_at <= ?
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY tournament_id, role LIMIT ?`,
      )
      .bind(source.principal_id, now, now, ROLE_LIMIT + 1)
      .all<LegacyRoleRow>(),
  ])
  const credentials = credentialRows.results
  const entries = entryRows.results
  const roles = roleRows.results
  const authenticatingCredential = credentials.find(row => row.credential_id === credentialId)
  if (
    !authenticatingCredential ||
    credentials.length === 0 ||
    credentials.length > CREDENTIAL_LIMIT ||
    entries.length > ENTRY_LIMIT ||
    roles.length > ROLE_LIMIT ||
    occupied
  ) {
    return null
  }

  const accountId = createOpaqueToken()
  const sourceRevision = Math.max(...credentials.map(row => row.revision))
  const snapshot = await legacyParticipantSnapshot(
    source.principal_id,
    source.webauthn_user_handle,
    credentials,
    entries,
    roles,
  )
  const proofNonce = createOpaqueToken()
  const statements: IdentityStatement[] = [
    database
      .prepare(
        `INSERT INTO identity_account
          (id, webauthn_user_handle, display_name, status, verification_state,
           created_at, updated_at)
         VALUES (?, ?, ?, 'active', 'legacy_unverified', ?, ?)`,
      )
      .bind(
        accountId,
        source.webauthn_user_handle,
        displayName(source),
        sourceCreatedAt(source.created_at, now),
        now,
      ),
  ]
  try {
    statements.push(
      ...legacyParticipantCopyStatements(database, {
        principalId: source.principal_id,
        accountId,
        credentials,
        entries,
        roles,
        now,
      }),
    )
  } catch {
    return null
  }
  statements.push(
    legacyParticipantMapProofStatement(database, {
      principalId: source.principal_id,
      accountId,
      sourceRevision,
      snapshot: snapshot.proof,
      proofNonce,
      now,
    }),
  )

  statements.push(
    database
      .prepare(
        `INSERT INTO identity_cutover
          (account_id, phase, cohort_key, migration_version, ready_at, active_at,
           target_only_at, created_at, updated_at)
         SELECT account_id, 3, 'legacy_participant', 1, ?, ?, ?, ?, ?
         FROM identity_legacy_subject_map
         WHERE subject_type = 'participant_principal' AND subject_id = ?
           AND account_id = ? AND write_nonce = ?`,
      )
      .bind(now, now, now, now, now, source.principal_id, accountId, proofNonce),
  )
  statements.push(
    database
      .prepare(
        `DELETE FROM participant_session WHERE principal_id = ? AND EXISTS (
           SELECT 1 FROM identity_legacy_subject_map
           WHERE subject_type = 'participant_principal' AND subject_id = ?
             AND account_id = ? AND write_nonce = ?
         )`,
      )
      .bind(source.principal_id, source.principal_id, accountId, proofNonce),
    await completionEvent(database, {
      accountId,
      principalId: source.principal_id,
      proofNonce,
      credentials: credentials.length,
      registrations: entries.length,
      roles: roles.length,
      now,
    }),
  )

  return {
    kind: 'prepared',
    accountId,
    principalId: source.principal_id,
    userHandle: source.webauthn_user_handle,
    credential: authenticatingCredential,
    statements,
  }
}

export async function migrateLegacyParticipantCredential(
  database: IdentityDatabase,
  credentialId: string,
  now = Date.now(),
) {
  const migration = await prepareLegacyParticipantMigration(database, credentialId, now)
  if (!migration) return null
  if (migration.kind === 'mapped') return migration.accountId
  try {
    await database.batch([...migration.statements])
  } catch (error) {
    const raced = await database
      .prepare(
        `SELECT account_id FROM identity_legacy_subject_map
         WHERE subject_type = 'participant_principal' AND subject_id = ? LIMIT 1`,
      )
      .bind(migration.principalId)
      .first<{ account_id: string }>()
    if (!raced) throw error
    return raced.account_id
  }
  return migration.accountId
}

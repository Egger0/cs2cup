import 'server-only'

import { base64UrlToBytes, createOpaqueToken, hashOpaqueToken } from '../../opaque-token.ts'
import type { IdentityDatabase, IdentityStatement } from './contracts.ts'

export interface LegacyCredentialRow {
  credential_id: string
  public_key: string
  counter: number
  transports_json: string
  device_type: 'singleDevice' | 'multiDevice'
  backed_up: number
  revision: number
  created_at: number
  last_used_at: number | null
}

export interface LegacyEntryRow {
  team_id: number
}

export interface LegacyRoleRow {
  tournament_id: number
  role: 'organizer' | 'referee' | 'check_in_operator'
  granted_at: number
  expires_at: number | null
}

const SOURCE_PROOF = `
  EXISTS (
    SELECT 1 FROM participant_principal AS principal
    JOIN identity_account AS account ON account.webauthn_user_handle = principal.webauthn_user_handle
    WHERE principal.id = proof.principal_id AND account.id = proof.account_id
      AND account.status = 'active'
  )
  AND (SELECT COUNT(*) FROM participant_passkey_credential AS source
       WHERE source.principal_id = proof.principal_id)
    = json_array_length(proof.snapshot, '$.credentials')
  AND NOT EXISTS (
    SELECT 1 FROM json_each(proof.snapshot, '$.credentials') AS item
    WHERE NOT EXISTS (
      SELECT 1 FROM participant_passkey_credential AS source
      JOIN identity_passkey_credential AS target
        ON target.credential_id = source.credential_id
       AND target.account_id = proof.account_id
       AND target.registration_kind = 'legacy_migration' AND target.status = 'active'
      WHERE source.principal_id = proof.principal_id
        AND source.credential_id = json_extract(item.value, '$[0]')
        AND source.revision = json_extract(item.value, '$[1]')
        AND source.counter = json_extract(item.value, '$[2]')
    )
  )
  AND (SELECT COUNT(*) FROM tournament_entry_owner AS source
       WHERE source.principal_id = proof.principal_id)
    = json_array_length(proof.snapshot, '$.entries')
  AND NOT EXISTS (
    SELECT 1 FROM json_each(proof.snapshot, '$.entries') AS item
    WHERE NOT EXISTS (
      SELECT 1 FROM tournament_entry_owner AS source
      JOIN identity_registration_membership AS target
        ON target.team_id = source.team_id AND target.account_id = proof.account_id
       AND target.relationship = 'owner' AND target.revoked_at IS NULL
      WHERE source.principal_id = proof.principal_id AND source.team_id = item.value
    )
  )
  AND (SELECT COUNT(*) FROM tournament_role_assignment AS source
       WHERE source.principal_id = proof.principal_id AND source.revoked_at IS NULL
         AND source.granted_at <= proof.checked_at
         AND (source.expires_at IS NULL OR source.expires_at > proof.checked_at))
    = json_array_length(proof.snapshot, '$.roles')
  AND NOT EXISTS (
    SELECT 1 FROM json_each(proof.snapshot, '$.roles') AS item
    WHERE NOT EXISTS (
      SELECT 1 FROM tournament_role_assignment AS source
      JOIN identity_role_assignment AS target
        ON target.account_id = proof.account_id AND target.role = source.role
       AND target.scope_type = 'tournament'
       AND target.scope_tournament_id = source.tournament_id
       AND target.granted_at = source.granted_at AND target.expires_at IS source.expires_at
       AND target.revoked_at IS NULL
      WHERE source.principal_id = proof.principal_id
        AND source.tournament_id = json_extract(item.value, '$[0]')
        AND source.role = json_extract(item.value, '$[1]')
        AND source.granted_at = json_extract(item.value, '$[2]')
        AND source.expires_at IS json_extract(item.value, '$[3]')
        AND source.revoked_at IS NULL AND source.granted_at <= proof.checked_at
        AND (source.expires_at IS NULL OR source.expires_at > proof.checked_at)
    )
  )`

export async function legacyParticipantSnapshot(
  principalId: string,
  userHandle: string,
  credentials: readonly LegacyCredentialRow[],
  entries: readonly LegacyEntryRow[],
  roles: readonly LegacyRoleRow[],
) {
  const payload = {
    principalId,
    userHandle,
    credentials: credentials.map(row => [row.credential_id, row.revision, row.counter]),
    entries: entries.map(row => row.team_id),
    roles: roles.map(row => [row.tournament_id, row.role, row.granted_at, row.expires_at]),
  }
  const hash = await hashOpaqueToken(JSON.stringify(payload))
  return { hash, proof: JSON.stringify({ ...payload, hash }) }
}

export function legacyParticipantCopyStatements(
  database: IdentityDatabase,
  input: {
    principalId: string
    accountId: string
    credentials: readonly LegacyCredentialRow[]
    entries: readonly LegacyEntryRow[]
    roles: readonly LegacyRoleRow[]
    now: number
  },
) {
  const statements: IdentityStatement[] = []
  for (const source of input.credentials) {
    const publicKey = base64UrlToBytes(source.public_key)
    statements.push(
      database
        .prepare(
          `INSERT INTO identity_passkey_credential
            (credential_id, account_id, registration_kind, public_key, counter,
             transports_json, device_type, backed_up, created_at, last_used_at, write_nonce)
           SELECT legacy.credential_id, ?, 'legacy_migration', ?, legacy.counter,
                  legacy.transports_json, legacy.device_type, legacy.backed_up,
                  legacy.created_at, legacy.last_used_at, ?
           FROM participant_passkey_credential AS legacy
           WHERE legacy.credential_id = ? AND legacy.principal_id = ?
             AND legacy.public_key = ? AND legacy.counter = ? AND legacy.transports_json = ?
             AND legacy.device_type = ? AND legacy.backed_up = ? AND legacy.revision = ?
             AND legacy.created_at = ? AND legacy.last_used_at IS ?
             AND NOT EXISTS (
               SELECT 1 FROM identity_passkey_credential WHERE credential_id = legacy.credential_id
             )`,
        )
        .bind(
          input.accountId,
          publicKey,
          createOpaqueToken(),
          source.credential_id,
          input.principalId,
          source.public_key,
          source.counter,
          source.transports_json,
          source.device_type,
          source.backed_up,
          source.revision,
          source.created_at,
          source.last_used_at,
        ),
    )
  }
  const entrySnapshot = JSON.stringify(input.entries.map(source => source.team_id))
  statements.push(
    database
      .prepare(
        `WITH expected(team_id) AS (
           SELECT CAST(value AS INTEGER) FROM json_each(json(?))
         )
         INSERT INTO identity_registration_membership
          (id, team_id, account_id, relationship, grant_reason, granted_at, write_nonce)
         SELECT substr(lower(hex(randomblob(32))), 1, 43), owner.team_id, ?, 'owner',
                'legacy participant migration', ?, substr(lower(hex(randomblob(32))), 1, 43)
         FROM expected
         JOIN tournament_entry_owner AS owner ON owner.team_id = expected.team_id
         WHERE owner.principal_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM identity_registration_membership
             WHERE team_id = owner.team_id AND relationship = 'owner' AND revoked_at IS NULL
           )`,
      )
      .bind(entrySnapshot, input.accountId, input.now, input.principalId),
  )
  const roleSnapshot = JSON.stringify(
    input.roles.map(source => [
      source.tournament_id,
      source.role,
      source.granted_at,
      source.expires_at,
    ]),
  )
  statements.push(
    database
      .prepare(
        `WITH expected(tournament_id, role, granted_at, expires_at) AS (
           SELECT CAST(json_extract(value, '$[0]') AS INTEGER),
                  json_extract(value, '$[1]'),
                  CAST(json_extract(value, '$[2]') AS INTEGER),
                  json_extract(value, '$[3]')
           FROM json_each(json(?))
         )
         INSERT INTO identity_role_assignment
          (id, account_id, role, scope_type, scope_tournament_id,
           grant_reason, granted_at, expires_at, write_nonce)
         SELECT substr(lower(hex(randomblob(32))), 1, 43), ?, legacy.role, 'tournament',
                legacy.tournament_id, 'legacy participant migration', legacy.granted_at,
                legacy.expires_at, substr(lower(hex(randomblob(32))), 1, 43)
         FROM expected
         JOIN tournament_role_assignment AS legacy
           ON legacy.tournament_id = expected.tournament_id
          AND legacy.role = expected.role
          AND legacy.granted_at = expected.granted_at
          AND legacy.expires_at IS expected.expires_at
         WHERE legacy.principal_id = ? AND legacy.revoked_at IS NULL
           AND legacy.granted_at <= ?
           AND (legacy.expires_at IS NULL OR legacy.expires_at > ?)
           AND NOT EXISTS (
             SELECT 1 FROM identity_role_assignment
             WHERE account_id = ? AND role = legacy.role AND scope_type = 'tournament'
               AND scope_tournament_id = legacy.tournament_id AND revoked_at IS NULL
           )`,
      )
      .bind(
        roleSnapshot,
        input.accountId,
        input.principalId,
        input.now,
        input.now,
        input.accountId,
      ),
  )
  return statements
}

export function legacyParticipantMapProofStatement(
  database: IdentityDatabase,
  input: {
    principalId: string
    accountId: string
    sourceRevision: number
    snapshot: string
    proofNonce: string
    now: number
  },
) {
  const proof = `WITH proof(snapshot, principal_id, account_id, checked_at)
    AS (VALUES (json(?), ?, ?, ?))`
  return database
    .prepare(
      `${proof}
       INSERT INTO identity_legacy_subject_map
        (subject_type, subject_id, account_id, source_revision, source_snapshot_hash,
         migration_version, mapped_at, write_nonce)
       SELECT 'participant_principal', proof.principal_id, proof.account_id, ?,
              json_extract(proof.snapshot, '$.hash'), 1, ?, ?
       FROM proof WHERE ${SOURCE_PROOF}`,
    )
    .bind(
      input.snapshot,
      input.principalId,
      input.accountId,
      input.now,
      input.sourceRevision,
      input.now,
      input.proofNonce,
    )
}

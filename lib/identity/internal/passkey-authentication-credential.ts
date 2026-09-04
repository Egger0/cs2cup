import 'server-only'

import { base64UrlToBytes } from '../../opaque-token.ts'
import { prepareLegacyParticipantMigration } from '../legacy-participant-migration.ts'
import type { IdentityDatabase, IdentityStatement } from './contracts.ts'
import {
  byteView,
  IdentityPasskeyError,
  passkeyTransports,
  validCounter,
  validOpaqueId,
  validPasskeyCredentialId,
} from './passkey-shared.ts'

interface UnifiedCredentialRow {
  credential_id: string
  account_id: string
  webauthn_user_handle: string
  public_key: ArrayBuffer | Uint8Array
  counter: number
  transports_json: string
  revision: number
}

interface LegacyCredentialRow {
  credential_id: string
  principal_id: string
  webauthn_user_handle: string
  public_key: string
  counter: number
  transports_json: string
  revision: number
}

interface VerificationCredential {
  readonly id: string
  readonly userHandle: string
  readonly publicKey: Uint8Array<ArrayBuffer>
  readonly counter: number
  readonly transports: string[]
}

export interface PasskeyAuthenticationCredential extends VerificationCredential {
  readonly source: 'identity'
  readonly accountId: string
  readonly revision: number
}

interface LegacyPasskeyAuthenticationCredential extends VerificationCredential {
  readonly source: 'legacy_participant'
  readonly principalId: string
  readonly revision: number
  readonly encodedPublicKey: string
  readonly transportsJson: string
}

export type PasskeyVerificationCredential =
  | PasskeyAuthenticationCredential
  | LegacyPasskeyAuthenticationCredential

function transports(value: string) {
  try {
    return passkeyTransports(JSON.parse(value))
  } catch {
    throw new IdentityPasskeyError('unknown_credential')
  }
}

function parseUnified(row: UnifiedCredentialRow | null): PasskeyAuthenticationCredential {
  if (
    !row ||
    !validPasskeyCredentialId(row.credential_id) ||
    !validOpaqueId(row.account_id) ||
    !validOpaqueId(row.webauthn_user_handle) ||
    !validCounter(row.counter) ||
    !validCounter(row.revision)
  ) {
    throw new IdentityPasskeyError('unknown_credential')
  }
  return Object.freeze({
    source: 'identity' as const,
    id: row.credential_id,
    accountId: row.account_id,
    userHandle: row.webauthn_user_handle,
    publicKey: byteView(row.public_key),
    counter: row.counter,
    transports: transports(row.transports_json),
    revision: row.revision,
  })
}

function parseLegacy(row: LegacyCredentialRow | null): LegacyPasskeyAuthenticationCredential {
  if (
    !row ||
    !validPasskeyCredentialId(row.credential_id) ||
    !/^p_[A-Za-z0-9_-]{43}$/.test(row.principal_id) ||
    !validOpaqueId(row.webauthn_user_handle) ||
    !validCounter(row.counter) ||
    !validCounter(row.revision)
  ) {
    throw new IdentityPasskeyError('unknown_credential')
  }
  let publicKey: Uint8Array<ArrayBuffer>
  try {
    publicKey = byteView(base64UrlToBytes(row.public_key))
  } catch {
    throw new IdentityPasskeyError('unknown_credential')
  }
  return Object.freeze({
    source: 'legacy_participant' as const,
    id: row.credential_id,
    principalId: row.principal_id,
    userHandle: row.webauthn_user_handle,
    publicKey,
    counter: row.counter,
    transports: transports(row.transports_json),
    revision: row.revision,
    encodedPublicKey: row.public_key,
    transportsJson: row.transports_json,
  })
}

function unifiedRow(database: IdentityDatabase, credentialId: string) {
  return database
    .prepare(
      `SELECT credential.credential_id, credential.account_id, account.webauthn_user_handle,
              credential.public_key, credential.counter, credential.transports_json,
              credential.revision
       FROM identity_passkey_credential AS credential
       JOIN identity_account AS account ON account.id = credential.account_id
       WHERE credential.credential_id = ? AND credential.status = 'active'
         AND account.status = 'active' LIMIT 1`,
    )
    .bind(credentialId)
    .first<UnifiedCredentialRow>()
}

function legacyRow(database: IdentityDatabase, credentialId: string) {
  return database
    .prepare(
      `SELECT credential.credential_id, credential.principal_id,
              principal.webauthn_user_handle, credential.public_key, credential.counter,
              credential.transports_json, credential.revision
       FROM participant_passkey_credential AS credential
       JOIN participant_principal AS principal ON principal.id = credential.principal_id
       WHERE credential.credential_id = ? AND NOT EXISTS (
         SELECT 1 FROM identity_legacy_subject_map AS migrated
         WHERE migrated.subject_type = 'participant_principal'
           AND migrated.subject_id = credential.principal_id
       ) LIMIT 1`,
    )
    .bind(credentialId)
    .first<LegacyCredentialRow>()
}

export async function passkeyAuthenticationCredential(
  database: IdentityDatabase,
  credentialId: string,
): Promise<PasskeyVerificationCredential> {
  if (!validPasskeyCredentialId(credentialId)) {
    throw new IdentityPasskeyError('unknown_credential')
  }
  const unified = await unifiedRow(database, credentialId)
  if (unified) return parseUnified(unified)
  const legacy = await legacyRow(database, credentialId)
  if (legacy) return parseLegacy(legacy)
  return parseUnified(await unifiedRow(database, credentialId))
}

export async function currentUnifiedPasskeyCredential(
  database: IdentityDatabase,
  credentialId: string,
) {
  const row = await unifiedRow(database, credentialId)
  return row ? parseUnified(row) : null
}

function verifiedUnifiedCredential(
  current: PasskeyAuthenticationCredential,
  verified: LegacyPasskeyAuthenticationCredential,
) {
  const sameKey =
    current.publicKey.byteLength === verified.publicKey.byteLength &&
    current.publicKey.every((value, index) => value === verified.publicKey[index])
  if (current.userHandle !== verified.userHandle || !sameKey) {
    throw new IdentityPasskeyError('conflict')
  }
  return current
}

export async function prepareVerifiedPasskeyCredential(
  database: IdentityDatabase,
  credential: PasskeyVerificationCredential,
  now: number,
) {
  if (credential.source === 'identity') {
    return { credential, migrationStatements: [] as readonly IdentityStatement[] }
  }
  const migration = await prepareLegacyParticipantMigration(database, credential.id, now)
  if (migration?.kind === 'prepared') {
    const source = migration.credential
    if (
      migration.principalId !== credential.principalId ||
      migration.userHandle !== credential.userHandle ||
      source.credential_id !== credential.id ||
      source.public_key !== credential.encodedPublicKey ||
      source.counter !== credential.counter ||
      source.transports_json !== credential.transportsJson ||
      source.revision !== credential.revision
    ) {
      throw new IdentityPasskeyError('conflict')
    }
    return {
      credential: Object.freeze<PasskeyAuthenticationCredential>({
        source: 'identity',
        id: credential.id,
        accountId: migration.accountId,
        userHandle: credential.userHandle,
        publicKey: credential.publicKey,
        counter: credential.counter,
        transports: credential.transports,
        revision: 0,
      }),
      migrationStatements: migration.statements,
    }
  }
  const current = await currentUnifiedPasskeyCredential(database, credential.id)
  if (!current) throw new IdentityPasskeyError('unknown_credential')
  return {
    credential: verifiedUnifiedCredential(current, credential),
    migrationStatements: [] as readonly IdentityStatement[],
  }
}

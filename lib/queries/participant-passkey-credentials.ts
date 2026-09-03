import 'server-only'

import { createOpaqueToken, isOpaqueToken } from '../opaque-token.ts'
import type { ConsumedPasskeyCeremony } from './participant-passkey-challenges.ts'
import {
  ParticipantPasskeyError,
  type ParticipantPasskeyDatabase,
} from './participant-passkey-shared.ts'

const CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{1,1366}$/
const PUBLIC_KEY_PATTERN = /^[A-Za-z0-9_-]{1,8192}$/
const TRANSPORTS = new Set(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'])
const SESSION_CLEANUP_BATCH = 64

interface CredentialRow {
  credential_id: string
  principal_id: string
  webauthn_user_handle: string
  public_key: string
  counter: number
  transports_json: string
  revision: number
}

export interface StoredParticipantCredential {
  id: string
  principalId: string
  userHandle: string
  publicKey: string
  counter: number
  transports: string[]
  revision: number
}

export interface ParticipantSessionDraft {
  tokenHash: string
  expiresAt: number
}

function validateOptionalSessionHash(value: string | null | undefined) {
  if (value !== null && value !== undefined && !/^[0-9a-f]{64}$/.test(value)) {
    throw new ParticipantPasskeyError('conflict')
  }
}

export interface ParticipantCredentialWrite {
  id: string
  publicKey: string
  counter: number
  transports: string[]
  deviceType: 'singleDevice' | 'multiDevice'
  backedUp: boolean
}

function validInteger(value: number) {
  return Number.isSafeInteger(value) && value >= 0
}

function validateCredential(input: ParticipantCredentialWrite) {
  if (
    !CREDENTIAL_PATTERN.test(input.id) ||
    !PUBLIC_KEY_PATTERN.test(input.publicKey) ||
    !validInteger(input.counter) ||
    !['singleDevice', 'multiDevice'].includes(input.deviceType) ||
    input.transports.length > 8 ||
    input.transports.some(value => !TRANSPORTS.has(value))
  ) {
    throw new ParticipantPasskeyError('conflict')
  }
}

function validateSession(input: ParticipantSessionDraft, now: number) {
  if (
    !/^[0-9a-f]{64}$/.test(input.tokenHash) ||
    !validInteger(input.expiresAt) ||
    input.expiresAt <= now ||
    input.expiresAt > now + 30 * 24 * 60 * 60 * 1000
  ) {
    throw new ParticipantPasskeyError('conflict')
  }
}

export async function finishParticipantClaim(
  db: ParticipantPasskeyDatabase,
  input: {
    ceremony: ConsumedPasskeyCeremony
    credential: ParticipantCredentialWrite
    session: ParticipantSessionDraft
    opposingAdminSessionHash?: string | null
    now: number
  },
) {
  const { ceremony } = input
  validateCredential(input.credential)
  validateSession(input.session, input.now)
  validateOptionalSessionHash(input.opposingAdminSessionHash)
  if (
    ceremony.kind !== 'claim' ||
    !ceremony.principalId ||
    !ceremony.userHandle ||
    !ceremony.teamId ||
    !ceremony.managementTokenHash ||
    !/^p_[A-Za-z0-9_-]{43}$/.test(ceremony.principalId) ||
    !isOpaqueToken(ceremony.userHandle)
  ) {
    throw new ParticipantPasskeyError('invalid_challenge')
  }
  const writeNonce = createOpaqueToken()
  const credential = input.credential
  try {
    await db.batch([
      db
        .prepare(
          'DELETE FROM participant_session WHERE token_hash IN (SELECT token_hash FROM participant_session WHERE expires_at <= ? ORDER BY expires_at LIMIT ?)',
        )
        .bind(input.now, SESSION_CLEANUP_BATCH),
      db
        .prepare('INSERT INTO participant_principal (id, webauthn_user_handle) VALUES (?, ?)')
        .bind(ceremony.principalId, ceremony.userHandle),
      db
        .prepare(
          "INSERT INTO tournament_entry_owner (team_id, principal_id, claim_method) SELECT team.id, ?, 'management_token' FROM team WHERE team.id = ? AND team.management_token_hash = ? AND NOT EXISTS (SELECT 1 FROM tournament_entry_owner WHERE team_id = team.id)",
        )
        .bind(ceremony.principalId, ceremony.teamId, ceremony.managementTokenHash),
      db
        .prepare(
          'INSERT INTO participant_passkey_credential (credential_id, principal_id, public_key, counter, transports_json, device_type, backed_up, revision, write_nonce, created_at) VALUES (?, (SELECT principal_id FROM tournament_entry_owner WHERE team_id = ? AND principal_id = ?), ?, ?, ?, ?, ?, 0, ?, ?)',
        )
        .bind(
          credential.id,
          ceremony.teamId,
          ceremony.principalId,
          credential.publicKey,
          credential.counter,
          JSON.stringify(credential.transports),
          credential.deviceType,
          credential.backedUp ? 1 : 0,
          writeNonce,
          input.now,
        ),
      db
        .prepare(
          'INSERT INTO participant_session (token_hash, principal_id, credential_id, created_at, expires_at) VALUES (CASE WHEN ? IS NULL OR NOT EXISTS (SELECT 1 FROM admin_session WHERE token_hash = ? AND expires_at > ?) THEN ? ELSE NULL END, (SELECT principal_id FROM participant_passkey_credential WHERE credential_id = ? AND principal_id = ? AND revision = 0 AND write_nonce = ?), ?, ?, ?)',
        )
        .bind(
          input.opposingAdminSessionHash ?? null,
          input.opposingAdminSessionHash ?? null,
          input.now,
          input.session.tokenHash,
          credential.id,
          ceremony.principalId,
          writeNonce,
          credential.id,
          input.now,
          input.session.expiresAt,
        ),
      db
        .prepare(
          'DELETE FROM participant_webauthn_challenge WHERE ceremony_token_hash = ? AND consume_nonce = ?',
        )
        .bind(ceremony.tokenHash, ceremony.consumeNonce),
    ])
  } catch {
    throw new ParticipantPasskeyError('conflict')
  }
  return { principalId: ceremony.principalId, credentialId: credential.id }
}

export async function participantCredentialById(
  db: ParticipantPasskeyDatabase,
  credentialId: string,
): Promise<StoredParticipantCredential> {
  if (!CREDENTIAL_PATTERN.test(credentialId)) {
    throw new ParticipantPasskeyError('unknown_credential')
  }
  const row = await db
    .prepare(
      'SELECT credential.credential_id, credential.principal_id, principal.webauthn_user_handle, credential.public_key, credential.counter, credential.transports_json, credential.revision FROM participant_passkey_credential AS credential JOIN participant_principal AS principal ON principal.id = credential.principal_id WHERE credential.credential_id = ?',
    )
    .bind(credentialId)
    .first<CredentialRow>()
  if (!row) throw new ParticipantPasskeyError('unknown_credential')
  let transports: unknown
  try {
    transports = JSON.parse(row.transports_json)
  } catch {
    throw new ParticipantPasskeyError('unknown_credential')
  }
  if (!Array.isArray(transports) || transports.some(value => typeof value !== 'string')) {
    throw new ParticipantPasskeyError('unknown_credential')
  }
  return {
    id: row.credential_id,
    principalId: row.principal_id,
    userHandle: row.webauthn_user_handle,
    publicKey: row.public_key,
    counter: row.counter,
    transports,
    revision: row.revision,
  }
}

export async function finishParticipantAuthentication(
  db: ParticipantPasskeyDatabase,
  input: {
    ceremony: ConsumedPasskeyCeremony
    credential: StoredParticipantCredential
    newCounter: number
    deviceType: 'singleDevice' | 'multiDevice'
    backedUp: boolean
    session: ParticipantSessionDraft
    opposingAdminSessionHash?: string | null
    now: number
  },
) {
  validateSession(input.session, input.now)
  validateOptionalSessionHash(input.opposingAdminSessionHash)
  if (
    input.ceremony.kind !== 'authentication' ||
    !validInteger(input.newCounter) ||
    input.newCounter < input.credential.counter
  ) {
    throw new ParticipantPasskeyError('conflict')
  }
  const nextRevision = input.credential.revision + 1
  const writeNonce = createOpaqueToken()
  try {
    await db.batch([
      db
        .prepare(
          'DELETE FROM participant_session WHERE token_hash IN (SELECT token_hash FROM participant_session WHERE expires_at <= ? ORDER BY expires_at LIMIT ?)',
        )
        .bind(input.now, SESSION_CLEANUP_BATCH),
      db
        .prepare(
          'UPDATE participant_passkey_credential SET counter = ?, device_type = ?, backed_up = ?, revision = ?, write_nonce = ?, last_used_at = ? WHERE credential_id = ? AND principal_id = ? AND counter = ? AND revision = ?',
        )
        .bind(
          input.newCounter,
          input.deviceType,
          input.backedUp ? 1 : 0,
          nextRevision,
          writeNonce,
          input.now,
          input.credential.id,
          input.credential.principalId,
          input.credential.counter,
          input.credential.revision,
        ),
      db
        .prepare(
          'INSERT INTO participant_session (token_hash, principal_id, credential_id, created_at, expires_at) VALUES (CASE WHEN ? IS NULL OR NOT EXISTS (SELECT 1 FROM admin_session WHERE token_hash = ? AND expires_at > ?) THEN ? ELSE NULL END, (SELECT principal_id FROM participant_passkey_credential WHERE credential_id = ? AND principal_id = ? AND revision = ? AND write_nonce = ?), ?, ?, ?)',
        )
        .bind(
          input.opposingAdminSessionHash ?? null,
          input.opposingAdminSessionHash ?? null,
          input.now,
          input.session.tokenHash,
          input.credential.id,
          input.credential.principalId,
          nextRevision,
          writeNonce,
          input.credential.id,
          input.now,
          input.session.expiresAt,
        ),
      db
        .prepare(
          'DELETE FROM participant_webauthn_challenge WHERE ceremony_token_hash = ? AND consume_nonce = ?',
        )
        .bind(input.ceremony.tokenHash, input.ceremony.consumeNonce),
    ])
  } catch {
    throw new ParticipantPasskeyError('conflict')
  }
  return { principalId: input.credential.principalId }
}

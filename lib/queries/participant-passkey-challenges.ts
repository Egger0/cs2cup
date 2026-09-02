import 'server-only'

import { createOpaqueToken, hashOpaqueToken, isOpaqueToken } from '../opaque-token.ts'
import { hashRegistrationToken } from '../registration-access.ts'
import {
  ParticipantPasskeyError,
  type ParticipantPasskeyDatabase,
  type PasskeyCeremonyKind,
} from './participant-passkey-shared.ts'

const ATTEMPT_WINDOW_MS = 10 * 60 * 1000
const CHALLENGE_TTL_MS = 5 * 60 * 1000
const TRANSIENT_CLEANUP_BATCH = 64
const FINGERPRINT_PATTERN = /^v1:[0-9a-f]{64}$/
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/

interface ClaimEntryRow {
  team_id: number
  team_name: string
  team_tag: string
  tournament_title: string
  principal_id: string | null
}

interface CeremonyRow {
  ceremony_token_hash: string
  challenge: string
  kind: PasskeyCeremonyKind
  candidate_principal_id: string | null
  candidate_user_handle: string | null
  candidate_team_id: number | null
  candidate_management_token_hash: string | null
  consume_nonce: string
}

export interface ConsumedPasskeyCeremony {
  tokenHash: string
  challenge: string
  kind: PasskeyCeremonyKind
  principalId: string | null
  userHandle: string | null
  teamId: number | null
  managementTokenHash: string | null
  consumeNonce: string
}

function exactNow(now: number) {
  if (!Number.isSafeInteger(now) || now < 0) throw new ParticipantPasskeyError('invalid_challenge')
  return now
}

async function enforceAttemptLimit(
  db: ParticipantPasskeyDatabase,
  kind: PasskeyCeremonyKind,
  fingerprint: string,
  now: number,
) {
  if (!FINGERPRINT_PATTERN.test(fingerprint)) {
    throw new ParticipantPasskeyError('rate_limited')
  }
  const bucket = Math.floor(now / ATTEMPT_WINDOW_MS) * ATTEMPT_WINDOW_MS
  await db
    .prepare(
      'DELETE FROM participant_passkey_attempt WHERE (bucket_start, kind, fingerprint) IN (SELECT bucket_start, kind, fingerprint FROM participant_passkey_attempt WHERE expires_at <= ? ORDER BY expires_at, bucket_start, kind, fingerprint LIMIT ?)',
    )
    .bind(now, TRANSIENT_CLEANUP_BATCH)
    .run()
  const admitted = await db
    .prepare(
      'INSERT INTO participant_passkey_attempt (bucket_start, kind, fingerprint, attempt_count, expires_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT (bucket_start, kind, fingerprint) DO UPDATE SET attempt_count = attempt_count + 1 WHERE attempt_count < 5 RETURNING attempt_count',
    )
    .bind(bucket, kind, fingerprint, bucket + ATTEMPT_WINDOW_MS)
    .first<{ attempt_count: number }>()
  if (!admitted) throw new ParticipantPasskeyError('rate_limited')
}

async function replacePreviousCeremony(
  db: ParticipantPasskeyDatabase,
  previousToken: string | null,
  now: number,
) {
  if (previousToken && isOpaqueToken(previousToken)) {
    await db
      .prepare(
        'DELETE FROM participant_webauthn_challenge WHERE ceremony_token_hash = ? AND consumed_at IS NULL',
      )
      .bind(await hashOpaqueToken(previousToken))
      .run()
  }
  await db
    .prepare(
      'DELETE FROM participant_webauthn_challenge WHERE ceremony_token_hash IN (SELECT ceremony_token_hash FROM participant_webauthn_challenge WHERE expires_at <= ? ORDER BY expires_at LIMIT ?)',
    )
    .bind(now, TRANSIENT_CLEANUP_BATCH)
    .run()
}

export async function beginClaimCeremony(
  db: ParticipantPasskeyDatabase,
  input: {
    slug: string
    managementToken: string
    fingerprint: string
    ceremonyToken: string
    challenge: string
    principalId: string
    userHandle: string
    previousToken: string | null
    now: number
  },
) {
  const now = exactNow(input.now)
  if (
    !SLUG_PATTERN.test(input.slug) ||
    !isOpaqueToken(input.ceremonyToken) ||
    !isOpaqueToken(input.challenge) ||
    !/^p_[A-Za-z0-9_-]{43}$/.test(input.principalId) ||
    !isOpaqueToken(input.userHandle)
  ) {
    throw new ParticipantPasskeyError('invalid_claim')
  }
  const managementTokenHash = await hashRegistrationToken(input.managementToken)
  if (!managementTokenHash) throw new ParticipantPasskeyError('invalid_claim')

  await enforceAttemptLimit(db, 'claim', input.fingerprint, now)
  await replacePreviousCeremony(db, input.previousToken, now)
  const entry = await db
    .prepare(
      'SELECT team.id AS team_id, team.name AS team_name, team.tag AS team_tag, tournament.title AS tournament_title, owner.principal_id FROM team JOIN tournament ON tournament.id = team.tournament_id LEFT JOIN tournament_entry_owner AS owner ON owner.team_id = team.id WHERE tournament.slug = ? AND team.management_token_hash = ?',
    )
    .bind(input.slug, managementTokenHash)
    .first<ClaimEntryRow>()
  if (!entry) throw new ParticipantPasskeyError('invalid_claim')
  if (entry.principal_id) throw new ParticipantPasskeyError('entry_already_claimed')

  const ceremonyTokenHash = await hashOpaqueToken(input.ceremonyToken)
  await db
    .prepare(
      "INSERT INTO participant_webauthn_challenge (ceremony_token_hash, challenge, kind, candidate_principal_id, candidate_user_handle, candidate_team_id, candidate_management_token_hash, created_at, expires_at) SELECT ?, ?, 'claim', ?, ?, team.id, ?, ?, ? FROM team JOIN tournament ON tournament.id = team.tournament_id WHERE team.id = ? AND tournament.slug = ? AND team.management_token_hash = ? AND NOT EXISTS (SELECT 1 FROM tournament_entry_owner WHERE team_id = team.id)",
    )
    .bind(
      ceremonyTokenHash,
      input.challenge,
      input.principalId,
      input.userHandle,
      managementTokenHash,
      now,
      now + CHALLENGE_TTL_MS,
      entry.team_id,
      input.slug,
      managementTokenHash,
    )
    .run()
  const stored = await db
    .prepare(
      "SELECT ceremony_token_hash FROM participant_webauthn_challenge WHERE ceremony_token_hash = ? AND kind = 'claim'",
    )
    .bind(ceremonyTokenHash)
    .first()
  if (!stored) throw new ParticipantPasskeyError('invalid_claim')
  return {
    teamId: entry.team_id,
    teamName: entry.team_name,
    teamTag: entry.team_tag,
    tournamentTitle: entry.tournament_title,
  }
}

export async function beginAuthenticationCeremony(
  db: ParticipantPasskeyDatabase,
  input: {
    fingerprint: string
    ceremonyToken: string
    challenge: string
    previousToken: string | null
    now: number
  },
) {
  const now = exactNow(input.now)
  if (!isOpaqueToken(input.ceremonyToken) || !isOpaqueToken(input.challenge)) {
    throw new ParticipantPasskeyError('invalid_challenge')
  }
  await enforceAttemptLimit(db, 'authentication', input.fingerprint, now)
  await replacePreviousCeremony(db, input.previousToken, now)
  await db
    .prepare(
      "INSERT INTO participant_webauthn_challenge (ceremony_token_hash, challenge, kind, created_at, expires_at) VALUES (?, ?, 'authentication', ?, ?)",
    )
    .bind(await hashOpaqueToken(input.ceremonyToken), input.challenge, now, now + CHALLENGE_TTL_MS)
    .run()
}

export async function consumePasskeyCeremony(
  db: ParticipantPasskeyDatabase,
  input: { token: string; kind: PasskeyCeremonyKind; now: number },
): Promise<ConsumedPasskeyCeremony> {
  const now = exactNow(input.now)
  if (!isOpaqueToken(input.token)) throw new ParticipantPasskeyError('invalid_challenge')
  const tokenHash = await hashOpaqueToken(input.token)
  const consumeNonce = createOpaqueToken()
  await db
    .prepare(
      'UPDATE participant_webauthn_challenge SET consumed_at = ?, consume_nonce = ? WHERE ceremony_token_hash = ? AND kind = ? AND consumed_at IS NULL AND expires_at > ?',
    )
    .bind(now, consumeNonce, tokenHash, input.kind, now)
    .run()
  const row = await db
    .prepare(
      'SELECT ceremony_token_hash, challenge, kind, candidate_principal_id, candidate_user_handle, candidate_team_id, candidate_management_token_hash, consume_nonce FROM participant_webauthn_challenge WHERE ceremony_token_hash = ? AND kind = ? AND consume_nonce = ?',
    )
    .bind(tokenHash, input.kind, consumeNonce)
    .first<CeremonyRow>()
  if (!row) throw new ParticipantPasskeyError('invalid_challenge')
  return {
    tokenHash: row.ceremony_token_hash,
    challenge: row.challenge,
    kind: row.kind,
    principalId: row.candidate_principal_id,
    userHandle: row.candidate_user_handle,
    teamId: row.candidate_team_id,
    managementTokenHash: row.candidate_management_token_hash,
    consumeNonce: row.consume_nonce,
  }
}

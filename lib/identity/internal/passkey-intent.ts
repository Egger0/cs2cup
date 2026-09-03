import 'server-only'

import { createOpaqueToken, hashOpaqueToken } from '../../opaque-token.ts'
import type { AuthenticatedAuthContext, IdentityDatabase } from './contracts.ts'
import { privateSessionContext } from './session-context.ts'
import {
  contextJson,
  exactPasskeyTime,
  IdentityPasskeyError,
  PASSKEY_INTENT_MAX_ATTEMPTS,
  PASSKEY_INTENT_TTL_MS,
  passkeyCeremonyHashes,
  validOpaqueId,
  validPasskeyHash,
} from './passkey-shared.ts'

export type PasskeyIntentPurpose = 'passkey_sign_in' | 'passkey_enrollment'

export interface IssuedPasskeyIntent {
  readonly id: string
  readonly secret: string
  readonly challenge: string
  readonly expiresAt: number
}

export interface ClaimedPasskeyIntent {
  readonly id: string
  readonly purpose: PasskeyIntentPurpose
  readonly expectedAccountId: string | null
  readonly secretHash: string
  readonly challenge: string
  readonly challengeHash: string
  readonly redirectKey: string
  readonly context: Readonly<Record<string, unknown>>
  readonly attemptCount: number
  readonly revision: number
  readonly expiresAt: number
}

interface IntentRow {
  id: string
  purpose: PasskeyIntentPurpose
  expected_account_id: string | null
  secret_hash: string
  passkey_challenge_hash: string
  redirect_key: string
  context_json: string
  attempt_count: number
  revision: number
  expires_at: number
}

function redirectKey(value: string) {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(value)) {
    throw new IdentityPasskeyError('invalid_request')
  }
  return value
}

function intentInsert(
  database: IdentityDatabase,
  input: {
    id: string
    secretHash: string
    purpose: PasskeyIntentPurpose
    expectedAccountId: string | null
    challengeHash: string
    redirectKey: string
    flowId: string
    idempotencyKey: string
    context: string
    now: number
  },
) {
  return database
    .prepare(
      `INSERT INTO identity_auth_intent
        (id, secret_hash, purpose, expected_account_id, passkey_challenge_hash, redirect_key,
         flow_id, idempotency_key, context_json, max_attempts, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .bind(
      input.id,
      input.secretHash,
      input.purpose,
      input.expectedAccountId,
      input.challengeHash,
      input.redirectKey,
      input.flowId,
      input.idempotencyKey,
      input.context,
      PASSKEY_INTENT_MAX_ATTEMPTS,
      input.now,
      input.now + PASSKEY_INTENT_TTL_MS,
    )
}

export async function issuePasskeyIntent(
  database: IdentityDatabase,
  input: {
    purpose: PasskeyIntentPurpose
    context: Readonly<Record<string, unknown>>
    redirectKey: string
    authenticatedContext?: AuthenticatedAuthContext
    now: number
  },
): Promise<IssuedPasskeyIntent> {
  const now = exactPasskeyTime(input.now)
  if (now > Number.MAX_SAFE_INTEGER - PASSKEY_INTENT_TTL_MS) {
    throw new IdentityPasskeyError('invalid_request')
  }
  const enrollment = input.purpose === 'passkey_enrollment'
  const context = input.authenticatedContext
  const privateContext = context ? privateSessionContext(context) : null
  if (enrollment && (!context || !privateContext)) {
    throw new IdentityPasskeyError('not_authenticated')
  }
  if (enrollment && context?.session.recoveryRestricted) {
    throw new IdentityPasskeyError('recovery_restricted')
  }
  if (!enrollment && context) throw new IdentityPasskeyError('invalid_request')

  const secret = createOpaqueToken()
  const hashes = await passkeyCeremonyHashes(secret)
  const id = createOpaqueToken()
  const statement = intentInsert(database, {
    id,
    secretHash: hashes.secretHash,
    purpose: input.purpose,
    expectedAccountId: context?.account.id ?? null,
    challengeHash: hashes.challengeHash,
    redirectKey: redirectKey(input.redirectKey),
    flowId: createOpaqueToken(),
    idempotencyKey: await hashOpaqueToken(createOpaqueToken()),
    context: contextJson(input.context),
    now,
  })
  if (enrollment && context && privateContext) {
    await database.batch([
      statement,
      database
        .prepare(
          `INSERT INTO identity_passkey_enrollment_authorization
            (auth_intent_id, account_id, initiating_session_id, authorized_at)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(id, context.account.id, context.session.id, now),
    ])
  } else if (!(await statement.first<{ id: string }>())) {
    throw new IdentityPasskeyError('conflict')
  }
  return { id, secret, challenge: hashes.challenge, expiresAt: now + PASSKEY_INTENT_TTL_MS }
}

function claimedIntent(
  row: IntentRow | null,
  hashes: Awaited<ReturnType<typeof passkeyCeremonyHashes>>,
) {
  if (
    !row ||
    !validOpaqueId(row.id) ||
    !['passkey_sign_in', 'passkey_enrollment'].includes(row.purpose) ||
    (row.expected_account_id !== null && !validOpaqueId(row.expected_account_id)) ||
    row.secret_hash !== hashes.secretHash ||
    row.passkey_challenge_hash !== hashes.challengeHash ||
    !validPasskeyHash(row.secret_hash) ||
    !Number.isSafeInteger(row.attempt_count) ||
    row.attempt_count < 1 ||
    row.attempt_count > PASSKEY_INTENT_MAX_ATTEMPTS ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1
  ) {
    throw new IdentityPasskeyError('invalid_ceremony')
  }
  let context: unknown
  try {
    context = JSON.parse(row.context_json)
  } catch {
    throw new IdentityPasskeyError('invalid_ceremony')
  }
  if (!context || Array.isArray(context) || typeof context !== 'object') {
    throw new IdentityPasskeyError('invalid_ceremony')
  }
  return {
    id: row.id,
    purpose: row.purpose,
    expectedAccountId: row.expected_account_id,
    secretHash: row.secret_hash,
    challenge: hashes.challenge,
    challengeHash: row.passkey_challenge_hash,
    redirectKey: row.redirect_key,
    context: Object.freeze(context as Record<string, unknown>),
    attemptCount: row.attempt_count,
    revision: row.revision,
    expiresAt: row.expires_at,
  }
}

export async function claimPasskeyIntentAttempt(
  database: IdentityDatabase,
  input: {
    purpose: PasskeyIntentPurpose
    secret: string
    authenticatedContext?: AuthenticatedAuthContext
    now: number
  },
): Promise<ClaimedPasskeyIntent> {
  const now = exactPasskeyTime(input.now)
  const hashes = await passkeyCeremonyHashes(input.secret)
  const context = input.authenticatedContext
  const privateContext = context ? privateSessionContext(context) : null
  if (input.purpose === 'passkey_enrollment' && (!context || !privateContext)) {
    throw new IdentityPasskeyError('not_authenticated')
  }
  if (context?.session.recoveryRestricted) throw new IdentityPasskeyError('recovery_restricted')
  const enrollmentProof =
    input.purpose === 'passkey_enrollment'
      ? `AND intent.expected_account_id = ? AND EXISTS (
         SELECT 1 FROM identity_passkey_enrollment_authorization AS authorization
         JOIN identity_session AS session ON session.id = authorization.initiating_session_id
         JOIN identity_account AS account ON account.id = authorization.account_id
         WHERE authorization.auth_intent_id = intent.id AND authorization.account_id = ?
           AND session.id = ? AND session.token_hash = ? AND session.revoked_at IS NULL
           AND session.recovery_restricted = 0 AND session.security_version = account.security_version
           AND account.status = 'active' AND session.idle_expires_at > ?
           AND session.absolute_expires_at > ?
       )`
      : 'AND intent.expected_account_id IS NULL'
  const values =
    input.purpose === 'passkey_enrollment' && context && privateContext
      ? [
          context.account.id,
          context.account.id,
          context.session.id,
          privateContext.tokenHash,
          now,
          now,
        ]
      : []
  const row = await database
    .prepare(
      `UPDATE identity_auth_intent AS intent
       SET attempt_count = attempt_count + 1, last_attempt_at = ?,
           revision = revision + 1, write_nonce = ?
       WHERE intent.purpose = ? AND intent.secret_hash = ?
         AND intent.passkey_challenge_hash = ? AND intent.consumed_at IS NULL
         AND intent.created_at <= ? AND intent.expires_at > ?
         AND intent.attempt_count < intent.max_attempts ${enrollmentProof}
       RETURNING id, purpose, expected_account_id, secret_hash, passkey_challenge_hash,
                 redirect_key, context_json, attempt_count, revision, expires_at`,
    )
    .bind(
      now,
      createOpaqueToken(),
      input.purpose,
      hashes.secretHash,
      hashes.challengeHash,
      now,
      now,
      ...values,
    )
    .first<IntentRow>()
  return claimedIntent(row, hashes)
}

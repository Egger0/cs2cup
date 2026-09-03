import {
  createSessionDraft,
  getAuthContext,
  sessionInsertStatement,
} from '../lib/identity/kernel.ts'
import { createMigratedDatabase } from './sqlite-fixture.mjs'
import { installPasswordKernelFixture } from './identity-password-kernel-fixture.mjs'
import { randomBytes } from 'node:crypto'

export const opaque = character => character.repeat(43)
export const hex = character => character.repeat(64)
export const accountIds = {
  owner: opaque('A'),
  manager: opaque('B'),
  platformOwner: opaque('C'),
  weakStaff: opaque('D'),
  recovery: opaque('E'),
  reviewer: opaque('F'),
}
export const credentialIds = {
  owner: opaque('K'),
  manager: opaque('L'),
  platformOwner: opaque('M'),
}
export const passwordCredentialIds = {
  weakStaff: opaque('p'),
  reviewer: opaque('q'),
}

export function d1Adapter(database) {
  return {
    prepare(query) {
      const statement = database.prepare(query)
      let bindings = []
      return {
        bind(...values) {
          bindings = values
          return {
            async first() {
              return statement.get(...bindings) ?? null
            },
            async all() {
              return { results: statement.all(...bindings) }
            },
            async run() {
              return statement.run(...bindings)
            },
          }
        },
      }
    },
    async batch(statements) {
      database.exec('BEGIN IMMEDIATE')
      try {
        const results = []
        for (const statement of statements) results.push(await statement.run())
        database.exec('COMMIT')
        return results
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },
  }
}

export async function createIdentityKernelFixture() {
  const database = await createMigratedDatabase()
  const db = d1Adapter(database)
  const now = Date.now()
  const execute = (sql, values = []) => database.prepare(sql).run(...values)

  database.exec(`
    INSERT INTO game (id, slug, name) VALUES (71, 'identity-kernel', 'Identity Kernel');
    INSERT INTO tournament (id, slug, title, game_id, season, edition, status, team_cap)
    VALUES
      (71, 'kernel-one', 'Kernel One', 71, '2026', 1, 'running', 8),
      (72, 'kernel-two', 'Kernel Two', 71, '2026', 2, 'registration', 8);
    INSERT INTO team (id, tournament_id, name, tag, captain, contact)
    VALUES
      (711, 71, 'Kernel Alpha', 'KAL', 'Alpha', 'private'),
      (722, 72, 'Kernel Bravo', 'KBR', 'Bravo', 'private');
  `)

  for (const [index, accountId] of Object.values(accountIds).entries()) {
    const verificationState = accountId === accountIds.manager ? 'legacy_unverified' : 'verified'
    execute(
      `INSERT INTO identity_account
        (id, webauthn_user_handle, display_name, status, verification_state, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?)`,
      [
        accountId,
        opaque(String(index)),
        `Person ${index + 1}`,
        verificationState,
        now - 14 * 60 * 60 * 1000,
        now - 14 * 60 * 60 * 1000,
      ],
    )
  }
  for (const [index, [name, credentialId]] of Object.entries(credentialIds).entries()) {
    execute(
      `INSERT INTO identity_passkey_credential
        (credential_id, account_id, registration_kind, public_key, device_type, created_at)
       VALUES (?, ?, 'legacy_migration', ?, 'multiDevice', ?)`,
      [credentialId, accountIds[name], Buffer.from(`public-key-${name}`), now - index - 1],
    )
  }

  const createPasswordProof = installPasswordKernelFixture({
    database,
    execute,
    now,
    accountIds,
    passwordCredentialIds,
  })

  const membership = (id, teamId, accountId, relationship) =>
    execute(
      `INSERT INTO identity_registration_membership
        (id, team_id, account_id, relationship, grant_reason, granted_at)
       VALUES (?, ?, ?, ?, 'kernel test', ?)`,
      [id, teamId, accountId, relationship, now - 1_000],
    )
  membership(opaque('N'), 711, accountIds.owner, 'owner')
  membership(opaque('O'), 711, accountIds.manager, 'manager')
  membership(opaque('P'), 722, accountIds.manager, 'owner')
  membership(opaque('Q'), 711, accountIds.recovery, 'manager')

  const assignment = (id, accountId, role, scopeType, tournamentId = null) =>
    execute(
      `INSERT INTO identity_role_assignment
        (id, account_id, role, scope_type, scope_tournament_id, grant_reason, granted_at)
       VALUES (?, ?, ?, ?, ?, 'kernel test', ?)`,
      [id, accountId, role, scopeType, tournamentId, now - 1_000],
    )
  assignment(opaque('R'), accountIds.owner, 'organizer', 'tournament', 71)
  assignment(opaque('S'), accountIds.manager, 'check_in_operator', 'tournament', 71)
  // Schema tests cover the one-time legacy bootstrap. This isolated policy fixture needs an
  // already-migrated owner so it can exercise the steady-state role-to-capability mapping.
  database.exec('DROP TRIGGER identity_initial_platform_owner_provenance_guard')
  assignment(opaque('T'), accountIds.platformOwner, 'platform_owner', 'platform')
  assignment(opaque('U'), accountIds.weakStaff, 'organizer', 'tournament', 71)
  assignment(opaque('G'), accountIds.reviewer, 'identity_reviewer', 'platform')

  function createPasskeyProof(accountId, credentialId, authenticatedAt = now) {
    const intentId = randomBytes(32).toString('base64url')
    const secretHash = randomBytes(32).toString('hex')
    const challengeHash = randomBytes(32).toString('hex')
    const idempotencyKey = randomBytes(32).toString('hex')
    execute(
      `INSERT INTO identity_auth_intent
        (id, secret_hash, purpose, expected_account_id, passkey_challenge_hash, redirect_key,
         flow_id, idempotency_key, created_at, expires_at)
       VALUES (?, ?, 'passkey_sign_in', ?, ?, 'account', ?, ?, ?, ?)`,
      [
        intentId,
        secretHash,
        accountId,
        challengeHash,
        randomBytes(32).toString('base64url'),
        idempotencyKey,
        authenticatedAt - 1_000,
        authenticatedAt + 60_000,
      ],
    )
    execute(
      `UPDATE identity_auth_intent
       SET consumed_at = ?, consume_nonce = ?, completion_result_type = 'passkey_credential',
           completion_result_ref = ?, revision = revision + 1, write_nonce = ?
       WHERE id = ?`,
      [
        authenticatedAt,
        randomBytes(32).toString('base64url'),
        credentialId,
        randomBytes(32).toString('base64url'),
        intentId,
      ],
    )
    return intentId
  }

  async function session(accountId, authentication, createdAt = now) {
    let normalizedAuthentication = authentication
    if (authentication.method === 'passkey' && !authentication.authIntentId) {
      normalizedAuthentication = {
        ...authentication,
        authIntentId: createPasskeyProof(
          accountId,
          authentication.authenticatorCredentialId,
          createdAt,
        ),
      }
    } else if (authentication.method === 'password' && !authentication.verificationNonce) {
      normalizedAuthentication = {
        ...authentication,
        verificationNonce: createPasswordProof(
          accountId,
          authentication.passwordCredentialId,
          createdAt,
        ),
      }
    }
    const draft = await createSessionDraft({
      accountId,
      authentication: normalizedAuthentication,
      now: createdAt,
    })
    const inserted = await sessionInsertStatement(db, draft).first()
    if (!inserted) throw new Error('Fixture session was not inserted')
    const context = await getAuthContext({ database: db, token: draft.token, now: createdAt })
    if (context.kind !== 'authenticated') throw new Error('Fixture session did not resolve')
    return { context, draft }
  }

  function createRecoveryProof() {
    const identityId = opaque('V')
    const intentId = opaque('W')
    execute(
      `INSERT INTO identity_verified_identity
        (id, account_id, adapter_kind, provider, issuer, subject, identity_key_hash,
         display_hint, recovery_capable, verified_at)
       VALUES (?, ?, 'oidc', 'campus', 'https://id.example', 'student-recovery', ?,
         's***@example.edu', 1, ?)`,
      [identityId, accountIds.recovery, hex('3'), now - 10_000],
    )
    execute(
      `INSERT INTO identity_auth_intent
        (id, secret_hash, purpose, expected_account_id, verified_identity_id, redirect_key,
         flow_id, idempotency_key, created_at, expires_at)
       VALUES (?, ?, 'recovery', ?, ?, 'account_security', ?, ?, ?, ?)`,
      [
        intentId,
        hex('4'),
        accountIds.recovery,
        identityId,
        opaque('X'),
        hex('5'),
        now - 1_000,
        now + 60_000,
      ],
    )
    execute(
      `UPDATE identity_auth_intent
       SET consumed_at = ?, consume_nonce = ?, completion_result_type = 'verified_identity',
           completion_result_ref = ?, revision = revision + 1, write_nonce = ?
       WHERE id = ?`,
      [now, opaque('Y'), identityId, opaque('Z'), intentId],
    )
    return intentId
  }

  return {
    database,
    db,
    execute,
    now,
    session,
    createPasskeyProof,
    createPasswordProof,
    createRecoveryProof,
  }
}

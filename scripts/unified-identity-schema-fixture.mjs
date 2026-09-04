import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'

import { createMigratedDatabase } from './sqlite-fixture.mjs'

export const opaque = character => character.repeat(43)
export const hash = character => character.repeat(64)
export const identityKeyHash = (provider, issuer, subject, version = 1) =>
  createHmac('sha256', 'unified-identity-schema-fixture-only')
    .update(`${version}\u0000${provider}\u0000${issuer}\u0000${subject}`)
    .digest('hex')
export const account = {
  alpha: opaque('A'),
  bravo: opaque('B'),
  charlie: opaque('C'),
}
export const identity = { alpha: opaque('D'), bravo: opaque('E'), cas: opaque('H') }
export const credential = { alpha: 'credential_alpha', bravo: 'credential_bravo' }

export function assertUnifiedIdentityBootstrapInvariants({
  expectError,
  insertAccount,
  insertIdentity,
}) {
  expectError(
    () => insertAccount(opaque('Z'), opaque('a'), 'Duplicate Handle'),
    /(?:UNIQUE|insert conflict)/,
  )
  expectError(() => insertAccount('not-an-account-id', opaque('z'), 'Invalid ID'), /CHECK/)
  expectError(
    () => insertIdentity(opaque('F'), account.bravo, 'https://id.example/tenant-a', 'Student-1'),
    /(?:UNIQUE|insert conflict)/,
  )
  expectError(
    () => insertIdentity(opaque('G'), opaque('Z'), 'https://id.example/tenant-z', 'Student-9'),
    /FOREIGN KEY/,
  )
}

export function assertUnifiedIdentityPrivateSchema(database) {
  for (const [table, plaintextColumns] of [
    ['identity_session', ['token']],
    ['identity_auth_intent', ['secret', 'passkey_challenge']],
    ['identity_access_invitation', ['secret', 'intended_identity_key']],
    ['identity_recovery_code', ['code', 'normalized_code', 'secret']],
    ['identity_auth_attempt_bucket', ['fingerprint', 'identity', 'ip_address']],
    ['identity_self_registration', ['request_proof', 'password']],
    ['identity_assisted_recovery_case', ['receipt']],
    ['identity_assisted_recovery_authorization', ['secret', 'receipt']],
    ['identity_legacy_admin_bootstrap', ['secret', 'legacy_session_token']],
  ]) {
    const columns = new Set(
      database
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map(row => row.name),
    )
    for (const plaintextColumn of plaintextColumns) {
      assert.equal(columns.has(plaintextColumn), false)
    }
  }
  const publicViews = database
    .prepare("SELECT sql FROM sqlite_schema WHERE type = 'view' AND name LIKE '%_public'")
    .all()
  for (const view of publicViews) assert.doesNotMatch(view.sql.toLowerCase(), /\bidentity_/)
}

export async function createUnifiedIdentitySchemaFixture() {
  const database = await createMigratedDatabase()
  const execute = (sql, values = []) => database.prepare(sql).run(...values)
  const expectError = (operation, message = /(?:CHECK|FOREIGN KEY|UNIQUE|conflict)/) =>
    assert.throws(operation, error => {
      assert.match(error.message, message)
      return true
    })
  const insertAccount = (id, handle, name) =>
    execute(
      `INSERT INTO identity_account
        (id, webauthn_user_handle, display_name, status, verification_state, created_at, updated_at)
       VALUES (?, ?, ?, 'active', 'verified', 100, 100)`,
      [id, handle, name],
    )
  const insertIdentity = (id, accountId, issuer, subject) =>
    execute(
      `INSERT INTO identity_verified_identity
        (id, account_id, adapter_kind, provider, issuer, subject, identity_key_hash,
         display_hint, verified_at)
       VALUES (?, ?, 'oidc', 'campus', ?, ?, ?, 's***@example.edu', 100)`,
      [id, accountId, issuer, subject, identityKeyHash('campus', issuer, subject)],
    )
  const insertCredential = (id, accountId) =>
    execute(
      `INSERT INTO identity_passkey_credential
        (credential_id, account_id, registration_kind, public_key, device_type, created_at)
       VALUES (?, ?, 'legacy_migration', ?, 'multiDevice', 100)`,
      [id, accountId, Buffer.from(`public-key-${id}`)],
    )

  const expectedTables = [
    'identity_access_invitation',
    'identity_account',
    'identity_assisted_recovery_authorization',
    'identity_assisted_recovery_case',
    'identity_assisted_recovery_review',
    'identity_auth_attempt_bucket',
    'identity_auth_attempt_window',
    'identity_auth_intent',
    'identity_cutover',
    'identity_legacy_admin_bootstrap',
    'identity_legacy_subject_map',
    'identity_membership',
    'identity_membership_application',
    'identity_membership_review',
    'identity_membership_review_transfer',
    'identity_membership_status_event',
    'identity_notification_outbox',
    'identity_passkey_account_setup',
    'identity_passkey_credential',
    'identity_passkey_enrollment_authorization',
    'identity_password_change',
    'identity_password_change_confirmation',
    'identity_password_credential',
    'identity_recovery_code',
    'identity_recovery_code_set',
    'identity_registration_draft',
    'identity_registration_invitation',
    'identity_registration_membership',
    'identity_registration_token_redemption',
    'identity_role_assignment',
    'identity_security_event',
    'identity_self_registration',
    'identity_session',
    'identity_session_before_password',
    'identity_verified_identity',
  ]
  const tables = database
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'identity_%'")
    .all()
    .map(row => row.name)
    .sort()
  assert.deepEqual(tables, expectedTables)
  assert.ok(
    database.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'participant_session'").get(),
  )

  database.exec(`
    INSERT INTO game (id, slug, name) VALUES (91, 'identity-schema', 'Identity Schema');
    INSERT INTO tournament (id, slug, title, game_id, season, edition, status, team_cap)
    VALUES (91, 'identity-schema-cup', 'Identity Schema Cup', 91, '2026', 1, 'registration', 8);
    INSERT INTO team (id, tournament_id, name, tag, captain, contact)
    VALUES (91, 91, 'Alpha', 'ALP', 'Captain', 'private');
  `)
  insertAccount(account.alpha, opaque('a'), 'Alpha Person')
  insertAccount(account.bravo, opaque('b'), 'Bravo Person')
  insertAccount(account.charlie, opaque('c'), 'Charlie Person')
  insertIdentity(identity.alpha, account.alpha, 'https://id.example/tenant-a', 'Student-1')
  insertIdentity(identity.bravo, account.bravo, 'https://id.example/tenant-b', 'Student-1')
  execute(
    `INSERT INTO identity_verified_identity
      (id, account_id, adapter_kind, provider, issuer, subject, identity_key_hash,
       display_hint, verified_at)
     VALUES (?, ?, 'cas', 'campus-cas', 'https://cas.example', 'Student-2', ?, 's***2', 100)`,
    [
      identity.cas,
      account.charlie,
      identityKeyHash('campus-cas', 'https://cas.example', 'Student-2'),
    ],
  )
  insertCredential(credential.alpha, account.alpha)
  insertCredential(credential.bravo, account.bravo)
  execute(
    `INSERT INTO identity_session
      (id, token_hash, account_id, security_version, auth_method, created_at, last_seen_at,
       idle_expires_at, absolute_expires_at, authenticated_at)
     VALUES (?, ?, ?, 0, 'cas', 100, 100, 1000, 2000, 100)`,
    [opaque('Y'), hash('0'), account.charlie],
  )
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM identity_security_event').get().count,
    0,
  )

  return { database, execute, expectError, insertAccount, insertIdentity }
}

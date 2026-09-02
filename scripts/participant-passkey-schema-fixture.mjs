import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { createMigratedDatabase } from './sqlite-fixture.mjs'

export const passkeyFixture = {
  alpha: `p_${'a'.repeat(43)}`,
  bravo: `p_${'b'.repeat(43)}`,
  candidate: `p_${'c'.repeat(43)}`,
  missing: `p_${'z'.repeat(43)}`,
  alphaCredential: 'credential_alpha-1',
  bravoCredential: 'credential_bravo-1',
  managementHash: 'a'.repeat(64),
}

export function expectDatabaseError(action, message) {
  assert.throws(action, error => {
    assert.match(error.message, new RegExp(message))
    return true
  })
}

export async function createPasskeySchemaDatabase() {
  const database = await createMigratedDatabase()
  const migration = await readFile(
    new URL('../cloudflare/d1/0010_participant_passkeys.sql', import.meta.url),
    'utf8',
  )
  database.exec(migration)
  const { alpha, bravo, managementHash } = passkeyFixture
  database.exec(`
    INSERT INTO game (id, slug, name) VALUES (1, 'cs2', 'CS2');
    INSERT INTO tournament
      (id, slug, title, game_id, season, edition, status, team_cap)
    VALUES (1, 'passkey-cup', 'Passkey Cup', 1, '2026', 1, 'registration', 8);
    INSERT INTO team
      (id, tournament_id, name, tag, captain, contact, management_token_hash)
    VALUES (10, 1, 'Alpha', 'AAA', 'Captain', 'private', '${managementHash}');
    INSERT INTO participant_principal (id, webauthn_user_handle) VALUES
      ('${alpha}', '${'A'.repeat(43)}'),
      ('${bravo}', '${'B'.repeat(43)}');
  `)
  return database
}

export function insertCredential(database, overrides = {}) {
  const { alpha, alphaCredential } = passkeyFixture
  const value = {
    id: alphaCredential,
    principal: alpha,
    publicKey: 'public_key-alpha_1',
    counter: 0,
    transports: '["internal","hybrid"]',
    deviceType: 'multiDevice',
    backedUp: 0,
    createdAt: 1_000,
    ...overrides,
  }
  return database
    .prepare(
      `
        INSERT INTO participant_passkey_credential
          (credential_id, principal_id, public_key, counter, transports_json,
           device_type, backed_up, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      value.id,
      value.principal,
      value.publicKey,
      value.counter,
      value.transports,
      value.deviceType,
      value.backedUp,
      value.createdAt,
    )
}

export function insertChallenge(database, overrides = {}) {
  const { candidate, managementHash } = passkeyFixture
  const value = {
    tokenHash: '1'.repeat(64),
    challenge: 'Q'.repeat(43),
    kind: 'claim',
    principal: candidate,
    userHandle: 'C'.repeat(43),
    teamId: 10,
    managementHash,
    consumeNonce: null,
    createdAt: 10_000,
    expiresAt: 310_000,
    consumedAt: null,
    ...overrides,
  }
  return database
    .prepare(
      `
        INSERT INTO participant_webauthn_challenge
          (ceremony_token_hash, challenge, kind, candidate_principal_id,
           candidate_user_handle, candidate_team_id, candidate_management_token_hash,
           consume_nonce, created_at, expires_at, consumed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      value.tokenHash,
      value.challenge,
      value.kind,
      value.principal,
      value.userHandle,
      value.teamId,
      value.managementHash,
      value.consumeNonce,
      value.createdAt,
      value.expiresAt,
      value.consumedAt,
    )
}

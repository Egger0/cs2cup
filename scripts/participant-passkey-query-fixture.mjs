import assert from 'node:assert/strict'

import { ParticipantPasskeyError } from '../lib/queries/participant-passkey-shared.ts'
import { hashRegistrationToken } from '../lib/registration-access.ts'
import { createMigratedDatabase } from './sqlite-fixture.mjs'

function d1Adapter(database) {
  return {
    prepare(query) {
      const statement = database.prepare(query)
      let bindings = []
      const prepared = {
        bind(...values) {
          bindings = values
          return prepared
        },
        async first() {
          return statement.get(...bindings) ?? null
        },
        async run() {
          return statement.run(...bindings)
        },
      }
      return prepared
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

export async function expectPasskeyError(action, code) {
  await assert.rejects(action, error => {
    assert.equal(error instanceof ParticipantPasskeyError, true)
    assert.equal(error.code, code)
    return true
  })
}

export function claimInput(overrides = {}) {
  return {
    slug: 'passkey-cup',
    managementToken: 'M'.repeat(43),
    fingerprint: `v1:${'a'.repeat(64)}`,
    ceremonyToken: 'C'.repeat(43),
    challenge: 'H'.repeat(43),
    principalId: `p_${'P'.repeat(43)}`,
    userHandle: 'U'.repeat(43),
    previousToken: null,
    now: 1_800_000_000_000,
    ...overrides,
  }
}

export async function createPasskeyQueryFixture() {
  const database = await createMigratedDatabase()
  const managementTokenHash = await hashRegistrationToken('M'.repeat(43))
  const secondTokenHash = await hashRegistrationToken('N'.repeat(43))
  database.prepare("INSERT INTO game (id, slug, name) VALUES (1, 'cs2', 'CS2')").run()
  database
    .prepare(
      "INSERT INTO tournament (id, slug, title, game_id, season, edition, status, team_cap) VALUES (1, 'passkey-cup', 'Passkey Cup', 1, '2026', 1, 'registration', 8)",
    )
    .run()
  database
    .prepare(
      "INSERT INTO team (id, tournament_id, name, tag, captain, contact, management_token_hash) VALUES (10, 1, 'Alpha', 'AAA', 'Captain', 'private', ?), (11, 1, 'Bravo', 'BBB', 'Captain', 'private', ?)",
    )
    .run(managementTokenHash, secondTokenHash)
  return { database, db: d1Adapter(database) }
}

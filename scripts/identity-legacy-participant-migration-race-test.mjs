import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

import { RecordingD1Database } from './recording-d1-fixture.mjs'
import { createMigratedDatabase } from './sqlite-fixture.mjs'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') {
      return { url: 'data:text/javascript,export {}', shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const { migrateLegacyParticipantCredential } =
  await import('../lib/identity/legacy-participant-migration.ts')
const opaque = character => character.repeat(43)
const now = 2_000_000_000_000

async function raceScenario(kind, suffix, tournamentId, teamId) {
  const database = await createMigratedDatabase()
  const db = new RecordingD1Database(database)
  const principalId = `p_${opaque(suffix)}`
  const replacementId = `p_${opaque(suffix.toLowerCase())}`
  const credentialId = `legacy-${kind}-race`
  try {
    database
      .prepare('INSERT INTO game (id, slug, name) VALUES (?, ?, ?)')
      .run(tournamentId, `game-${kind}`, `Game ${kind}`)
    database
      .prepare(
        `INSERT INTO tournament
          (id, slug, title, game_id, season, edition, status, team_cap)
         VALUES (?, ?, ?, ?, '2026', 1, 'registration', 8)`,
      )
      .run(tournamentId, `cup-${kind}`, `Cup ${kind}`, tournamentId)
    database
      .prepare(
        `INSERT INTO team (id, tournament_id, name, tag, captain, contact)
         VALUES (?, ?, ?, ?, 'Captain', 'private')`,
      )
      .run(teamId, tournamentId, `Team ${kind}`, suffix)
    database
      .prepare(
        `INSERT INTO participant_principal (id, webauthn_user_handle)
         VALUES (?, ?), (?, ?)`,
      )
      .run(principalId, opaque(suffix), replacementId, opaque(suffix.toLowerCase()))
    database
      .prepare(
        `INSERT INTO participant_passkey_credential
          (credential_id, principal_id, public_key, device_type, created_at)
         VALUES (?, ?, 'cHVibGlj', 'multiDevice', ?)`,
      )
      .run(credentialId, principalId, now - 10_000)
    database
      .prepare(
        `INSERT INTO tournament_entry_owner (team_id, principal_id, claim_method)
         VALUES (?, ?, 'management_token')`,
      )
      .run(teamId, principalId)
    database
      .prepare(
        `INSERT INTO tournament_role_assignment
          (tournament_id, principal_id, role, granted_at)
         VALUES (?, ?, 'check_in_operator', ?)`,
      )
      .run(tournamentId, principalId, now - 5_000)
    database
      .prepare(
        `INSERT INTO participant_session
          (token_hash, principal_id, credential_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        kind === 'role' ? 'a'.repeat(64) : 'b'.repeat(64),
        principalId,
        credentialId,
        now - 1_000,
        now + 60_000,
      )

    db.beforeBatch = () => {
      if (kind === 'role') {
        database
          .prepare(
            `UPDATE tournament_role_assignment SET revoked_at = ?
             WHERE tournament_id = ? AND principal_id = ? AND role = 'check_in_operator'`,
          )
          .run(now, tournamentId, principalId)
      } else {
        database
          .prepare('UPDATE tournament_entry_owner SET principal_id = ? WHERE team_id = ?')
          .run(replacementId, teamId)
      }
    }
    await assert.rejects(
      migrateLegacyParticipantCredential(db, credentialId, now),
      /(?:constraint|NOT NULL|identity_security_event)/i,
    )
    assert.equal(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM identity_legacy_subject_map
           WHERE subject_type = 'participant_principal' AND subject_id = ?`,
        )
        .get(principalId).count,
      0,
    )
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM identity_account').get().count, 0)
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM participant_session').get().count,
      1,
    )

    const accountId = await migrateLegacyParticipantCredential(db, credentialId, now + 1)
    assert.match(accountId ?? '', /^[A-Za-z0-9_-]{43}$/)
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM participant_session').get().count,
      0,
    )
    assert.equal(
      database
        .prepare('SELECT COUNT(*) AS count FROM identity_role_assignment WHERE account_id = ?')
        .get(accountId).count,
      kind === 'role' ? 0 : 1,
    )
    assert.equal(
      database
        .prepare(
          'SELECT COUNT(*) AS count FROM identity_registration_membership WHERE account_id = ?',
        )
        .get(accountId).count,
      kind === 'owner' ? 0 : 1,
    )
  } finally {
    database.close()
  }
}

await raceScenario('role', 'R', 191, 1910)
await raceScenario('owner', 'O', 192, 1920)
console.log('identity legacy participant migration race tests passed')

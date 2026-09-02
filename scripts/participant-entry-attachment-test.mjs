import assert from 'node:assert/strict'

import { hashOpaqueToken } from '../lib/opaque-token.ts'
import { exactParticipantEntryAttachmentBody } from '../lib/participant-entry-attachment-request.ts'
import { participantSessionHashFromRequest } from '../lib/participant-session-request.ts'
import {
  attachParticipantEntry,
  participantEntryOwnerPrincipal,
  ParticipantEntryAttachmentError,
} from '../lib/queries/participant-entry-attachment.ts'
import { hashRegistrationToken } from '../lib/registration-access.ts'
import { createMigratedDatabase } from './sqlite-fixture.mjs'

const NOW = 1_900_000_000_000
const SLUG = 'attachment-cup'
const SESSION_A = 'a'.repeat(64)
const SESSION_A_SECOND = 'e'.repeat(64)
const SESSION_B = 'b'.repeat(64)
const SESSION_EXPIRED = 'c'.repeat(64)
const SESSION_DELETED = 'd'.repeat(64)
const PRINCIPAL_A = `p_${'A'.repeat(43)}`
const PRINCIPAL_B = `p_${'B'.repeat(43)}`

const TOKENS = {
  first: 'M'.repeat(43),
  available: 'N'.repeat(43),
  owned: 'O'.repeat(43),
  race: 'P'.repeat(43),
  revoked: 'R'.repeat(43),
}

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
      }
      return prepared
    },
  }
}

async function expectAttachmentError(action, code) {
  await assert.rejects(action, error => {
    assert.equal(error instanceof ParticipantEntryAttachmentError, true)
    assert.equal(error.code, code)
    return true
  })
}

function requestWithSessionCookie(value) {
  return {
    cookies: {
      get(name) {
        return name === '__Host-cs2cup_participant' && value !== undefined ? { value } : undefined
      },
    },
  }
}

function insertPrincipal(database, { id, userHandle, credentialId, sessionHash }) {
  database
    .prepare('INSERT INTO participant_principal (id, webauthn_user_handle) VALUES (?, ?)')
    .run(id, userHandle)
  database
    .prepare(
      "INSERT INTO participant_passkey_credential (credential_id, principal_id, public_key, counter, device_type, backed_up, created_at) VALUES (?, ?, ?, 0, 'multiDevice', 1, ?)",
    )
    .run(credentialId, id, 'Q'.repeat(43), NOW - 10_000)
  database
    .prepare(
      'INSERT INTO participant_session (token_hash, principal_id, credential_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(sessionHash, id, credentialId, NOW - 5_000, NOW + 60_000)
}

async function insertTeam(database, id, name, tag, managementToken) {
  database
    .prepare(
      "INSERT INTO team (id, tournament_id, name, tag, captain, contact, management_token_hash) VALUES (?, 1, ?, ?, 'Captain', 'private', ?)",
    )
    .run(id, name, tag, await hashRegistrationToken(managementToken))
}

const database = await createMigratedDatabase()

try {
  const db = d1Adapter(database)
  database.prepare("INSERT INTO game (id, slug, name) VALUES (1, 'cs2', 'CS2')").run()
  database
    .prepare(
      "INSERT INTO tournament (id, slug, title, game_id, season, edition, status, team_cap) VALUES (1, ?, 'Attachment Cup', 1, '2026', 1, 'registration', 16)",
    )
    .run(SLUG)
  insertPrincipal(database, {
    id: PRINCIPAL_A,
    userHandle: 'U'.repeat(43),
    credentialId: 'K'.repeat(43),
    sessionHash: SESSION_A,
  })
  insertPrincipal(database, {
    id: PRINCIPAL_B,
    userHandle: 'V'.repeat(43),
    credentialId: 'L'.repeat(43),
    sessionHash: SESSION_B,
  })
  await insertTeam(database, 10, 'Alpha', 'AAA', TOKENS.first)
  await insertTeam(database, 11, 'Bravo', 'BBB', TOKENS.available)
  await insertTeam(database, 12, 'Charlie', 'CCC', TOKENS.owned)
  await insertTeam(database, 13, 'Delta', 'DDD', TOKENS.race)
  await insertTeam(database, 14, 'Echo', 'EEE', TOKENS.revoked)

  const first = await attachParticipantEntry(db, {
    sessionTokenHash: SESSION_A,
    slug: SLUG,
    managementToken: TOKENS.first,
    now: NOW,
  })
  assert.deepEqual(first, { teamId: 10, principalId: PRINCIPAL_A })
  const originalOwner = database
    .prepare(
      'SELECT principal_id, claim_method, claimed_at FROM tournament_entry_owner WHERE team_id = 10',
    )
    .get()
  assert.deepEqual(
    await attachParticipantEntry(db, {
      sessionTokenHash: SESSION_A,
      slug: SLUG,
      managementToken: TOKENS.first,
      now: NOW + 1,
    }),
    first,
  )
  assert.deepEqual(
    {
      ...database
        .prepare(
          'SELECT principal_id, claim_method, claimed_at FROM tournament_entry_owner WHERE team_id = 10',
        )
        .get(),
    },
    { ...originalOwner },
  )
  database
    .prepare(
      'INSERT INTO participant_session (token_hash, principal_id, credential_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(SESSION_A_SECOND, PRINCIPAL_A, 'K'.repeat(43), NOW - 4_000, NOW + 60_000)
  assert.deepEqual(
    await attachParticipantEntry(db, {
      sessionTokenHash: SESSION_A_SECOND,
      slug: SLUG,
      managementToken: TOKENS.first,
      now: NOW + 2,
    }),
    first,
  )
  assert.equal(await participantEntryOwnerPrincipal(db, 10), PRINCIPAL_A)

  database
    .prepare(
      'INSERT INTO participant_session (token_hash, principal_id, credential_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(SESSION_EXPIRED, PRINCIPAL_A, 'K'.repeat(43), NOW - 5_000, NOW)
  await expectAttachmentError(
    () =>
      attachParticipantEntry(db, {
        sessionTokenHash: SESSION_EXPIRED,
        slug: SLUG,
        managementToken: TOKENS.available,
        now: NOW,
      }),
    'invalid_session',
  )

  database
    .prepare(
      'INSERT INTO participant_session (token_hash, principal_id, credential_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(SESSION_DELETED, PRINCIPAL_A, 'K'.repeat(43), NOW - 5_000, NOW + 60_000)
  assert.equal(
    database
      .prepare('SELECT COUNT(*) AS count FROM participant_session WHERE token_hash = ?')
      .get(SESSION_DELETED).count,
    1,
  )
  database.prepare('DELETE FROM participant_session WHERE token_hash = ?').run(SESSION_DELETED)
  await expectAttachmentError(
    () =>
      attachParticipantEntry(db, {
        sessionTokenHash: SESSION_DELETED,
        slug: SLUG,
        managementToken: TOKENS.revoked,
        now: NOW,
      }),
    'invalid_session',
  )

  for (const target of [
    { slug: SLUG, managementToken: 'Z'.repeat(43) },
    { slug: SLUG, managementToken: 'short' },
    { slug: 'other-cup', managementToken: TOKENS.available },
  ]) {
    await expectAttachmentError(
      () =>
        attachParticipantEntry(db, {
          sessionTokenHash: SESSION_A,
          ...target,
          now: NOW,
        }),
      'invalid_entry',
    )
  }
  await expectAttachmentError(
    () =>
      attachParticipantEntry(db, {
        sessionTokenHash: 'A'.repeat(64),
        slug: SLUG,
        managementToken: TOKENS.available,
        now: NOW,
      }),
    'invalid_session',
  )

  database
    .prepare(
      "INSERT INTO tournament_entry_owner (team_id, principal_id, claim_method) VALUES (12, ?, 'management_token')",
    )
    .run(PRINCIPAL_B)
  await expectAttachmentError(
    () =>
      attachParticipantEntry(db, {
        sessionTokenHash: SESSION_A,
        slug: SLUG,
        managementToken: TOKENS.owned,
        now: NOW,
      }),
    'entry_owned_elsewhere',
  )
  assert.equal(await participantEntryOwnerPrincipal(db, 12), PRINCIPAL_B)

  const race = await Promise.allSettled([
    attachParticipantEntry(db, {
      sessionTokenHash: SESSION_A,
      slug: SLUG,
      managementToken: TOKENS.race,
      now: NOW,
    }),
    attachParticipantEntry(db, {
      sessionTokenHash: SESSION_B,
      slug: SLUG,
      managementToken: TOKENS.race,
      now: NOW,
    }),
  ])
  const winner = race.find(result => result.status === 'fulfilled')
  const loser = race.find(result => result.status === 'rejected')
  assert.ok(winner && winner.status === 'fulfilled')
  assert.ok(loser && loser.status === 'rejected')
  assert.equal(loser.reason.code, 'entry_owned_elsewhere')
  assert.equal(await participantEntryOwnerPrincipal(db, 13), winner.value.principalId)
  assert.equal(await participantEntryOwnerPrincipal(db, 999), null)

  for (const teamId of [11, 14]) {
    assert.equal(await participantEntryOwnerPrincipal(db, teamId), null)
  }
  const privateRows = JSON.stringify(
    database
      .prepare(
        'SELECT team.management_token_hash, owner.* FROM team LEFT JOIN tournament_entry_owner AS owner ON owner.team_id = team.id',
      )
      .all(),
  )
  for (const token of Object.values(TOKENS)) assert.equal(privateRows.includes(token), false)

  const rawSessionToken = 'S'.repeat(43)
  assert.equal(
    await participantSessionHashFromRequest(requestWithSessionCookie(rawSessionToken)),
    await hashOpaqueToken(rawSessionToken),
  )
  for (const invalidCookie of [undefined, 'short', `${'S'.repeat(42)}=`, `${'S'.repeat(42)}!`]) {
    assert.equal(
      await participantSessionHashFromRequest(requestWithSessionCookie(invalidCookie)),
      null,
    )
  }
  assert.deepEqual(
    exactParticipantEntryAttachmentBody({ slug: SLUG, managementToken: TOKENS.first }),
    { slug: SLUG, managementToken: TOKENS.first },
  )
  for (const invalidBody of [
    null,
    { slug: SLUG },
    { slug: SLUG, managementToken: 1 },
    { slug: SLUG, managementToken: TOKENS.first, principalId: PRINCIPAL_B },
  ]) {
    assert.equal(exactParticipantEntryAttachmentBody(invalidBody), null)
  }

  console.log('participant entry attachment tests passed')
} finally {
  database.close()
}

import assert from 'node:assert/strict'

import {
  canonicalExternalIdentity,
  claimTournamentEntryOwnership,
  ParticipantIdentityError,
  resolveParticipantIdentity,
} from '../lib/queries/participant-identity.ts'
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
      const results = []
      for (const statement of statements) results.push(await statement.run())
      return results
    },
  }
}

async function expectIdentityError(action, code) {
  await assert.rejects(action, error => {
    assert.equal(error instanceof ParticipantIdentityError, true)
    assert.equal(error.code, code)
    return true
  })
}

const database = await createMigratedDatabase()

try {
  const db = d1Adapter(database)
  const token = 'A'.repeat(43)
  const tokenHash = await hashRegistrationToken(token)
  database.prepare("INSERT INTO game (id, slug, name) VALUES (1, 'cs2', 'CS2')").run()
  database
    .prepare(
      "INSERT INTO tournament (id, slug, title, game_id, season, edition, status, team_cap) VALUES (1, 'autumn-cup', 'Autumn Cup', 1, '2026', 1, 'registration', 8)",
    )
    .run()
  database
    .prepare(
      "INSERT INTO team (id, tournament_id, name, tag, captain, contact, management_token_hash) VALUES (1, 1, 'Alpha', 'AAA', 'Captain', 'contact', ?)",
    )
    .run(tokenHash)

  const identity = {
    provider: 'oidc',
    issuer: 'https://identity.example.edu',
    subject: 'student-42',
  }
  const resolutions = await Promise.all(
    Array.from({ length: 8 }, () => resolveParticipantIdentity(db, identity)),
  )
  assert.equal(new Set(resolutions.map(value => value.id)).size, 1)
  assert.equal(new Set(resolutions.map(value => value.webauthnUserHandle)).size, 1)
  assert.match(resolutions[0].id, /^p_[A-Za-z0-9_-]{43}$/)
  assert.match(resolutions[0].webauthnUserHandle, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM participant_principal').get().count,
    1,
  )
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM participant_external_identity').get().count,
    1,
  )

  const otherIssuer = await resolveParticipantIdentity(db, {
    ...identity,
    issuer: 'https://accounts.example.edu',
  })
  const otherProvider = await resolveParticipantIdentity(db, { ...identity, provider: 'saml' })
  assert.notEqual(otherIssuer.id, resolutions[0].id)
  assert.notEqual(otherProvider.id, resolutions[0].id)
  assert.deepEqual(canonicalExternalIdentity(identity), identity)
  for (const invalid of [
    { ...identity, provider: 'OIDC' },
    { ...identity, issuer: ` ${identity.issuer}` },
    { ...identity, subject: 'student\u000042' },
  ]) {
    assert.throws(() => canonicalExternalIdentity(invalid), /invalid_identity/)
  }

  const firstClaim = await claimTournamentEntryOwnership(db, {
    principalId: resolutions[0].id,
    slug: 'autumn-cup',
    managementToken: token,
  })
  assert.deepEqual(firstClaim, { teamId: 1, principalId: resolutions[0].id })
  assert.deepEqual(
    await claimTournamentEntryOwnership(db, {
      principalId: resolutions[0].id,
      slug: 'autumn-cup',
      managementToken: token,
    }),
    firstClaim,
  )

  await expectIdentityError(
    () =>
      claimTournamentEntryOwnership(db, {
        principalId: otherIssuer.id,
        slug: 'autumn-cup',
        managementToken: token,
      }),
    'entry_already_claimed',
  )
  await expectIdentityError(
    () =>
      claimTournamentEntryOwnership(db, {
        principalId: otherIssuer.id,
        slug: 'autumn-cup',
        managementToken: 'invalid',
      }),
    'invalid_claim',
  )

  const owner = database
    .prepare('SELECT team_id, principal_id, claim_method FROM tournament_entry_owner')
    .get()
  assert.deepEqual(
    { ...owner },
    {
      team_id: 1,
      principal_id: resolutions[0].id,
      claim_method: 'management_token',
    },
  )
  const privateValues = JSON.stringify(
    database
      .prepare(
        'SELECT participant_principal.*, participant_external_identity.provider, participant_external_identity.issuer, participant_external_identity.subject, tournament_entry_owner.claim_method FROM participant_principal LEFT JOIN participant_external_identity ON participant_external_identity.principal_id = participant_principal.id LEFT JOIN tournament_entry_owner ON tournament_entry_owner.principal_id = participant_principal.id',
      )
      .all(),
  )
  assert.equal(privateValues.includes(token), false)

  console.log('participant identity and ownership tests passed')
} finally {
  database.close()
}

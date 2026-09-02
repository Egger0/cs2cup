import assert from 'node:assert/strict'

import { hashOpaqueToken } from '../lib/opaque-token.ts'
import { participantAccessReceipt } from '../lib/queries/participant-account.ts'
import {
  beginAuthenticationCeremony,
  beginClaimCeremony,
  consumePasskeyCeremony,
  participantPasskeyRetryAfterSeconds,
} from '../lib/queries/participant-passkey-challenges.ts'
import {
  finishParticipantAuthentication,
  finishParticipantClaim,
  participantCredentialById,
} from '../lib/queries/participant-passkey-credentials.ts'
import {
  claimInput,
  createPasskeyQueryFixture,
  expectPasskeyError,
} from './participant-passkey-query-fixture.mjs'

assert.equal(participantPasskeyRetryAfterSeconds(0), 600)
assert.equal(participantPasskeyRetryAfterSeconds(300_000), 300)
assert.equal(participantPasskeyRetryAfterSeconds(599_999), 1)
assert.equal(participantPasskeyRetryAfterSeconds(600_000), 600)

const { database, db } = await createPasskeyQueryFixture()

try {
  const entry = await beginClaimCeremony(db, claimInput())
  assert.deepEqual(entry, {
    teamId: 10,
    teamName: 'Alpha',
    teamTag: 'AAA',
    tournamentTitle: 'Passkey Cup',
  })
  const serializedChallenge = JSON.stringify(
    database.prepare('SELECT * FROM participant_webauthn_challenge').get(),
  )
  assert.equal(serializedChallenge.includes('M'.repeat(43)), false)
  const ceremony = await consumePasskeyCeremony(db, {
    token: 'C'.repeat(43),
    kind: 'claim',
    now: claimInput().now + 1,
  })
  assert.equal(ceremony.principalId, claimInput().principalId)
  await expectPasskeyError(
    () =>
      consumePasskeyCeremony(db, {
        token: 'C'.repeat(43),
        kind: 'claim',
        now: claimInput().now + 2,
      }),
    'invalid_challenge',
  )

  const firstSession = {
    tokenHash: await hashOpaqueToken('S'.repeat(43)),
    expiresAt: claimInput().now + 60_000,
  }
  await finishParticipantClaim(db, {
    ceremony,
    credential: {
      id: 'K'.repeat(43),
      publicKey: 'Q'.repeat(43),
      counter: 0,
      transports: ['internal', 'hybrid'],
      deviceType: 'multiDevice',
      backedUp: true,
    },
    session: firstSession,
    now: claimInput().now + 3,
  })
  assert.equal(
    database.prepare('SELECT principal_id FROM tournament_entry_owner').get().principal_id,
    claimInput().principalId,
  )
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM participant_session').get().count, 1)
  await expectPasskeyError(
    () =>
      beginClaimCeremony(
        db,
        claimInput({ ceremonyToken: 'D'.repeat(43), challenge: 'I'.repeat(43) }),
      ),
    'entry_already_claimed',
  )

  const authNow = claimInput().now + 10_000
  database
    .prepare(
      'INSERT INTO participant_session (token_hash, principal_id, credential_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(
      'f'.repeat(64),
      claimInput().principalId,
      'K'.repeat(43),
      claimInput().now + 4,
      authNow - 1,
    )
  await beginAuthenticationCeremony(db, {
    fingerprint: `v1:${'b'.repeat(64)}`,
    ceremonyToken: 'E'.repeat(43),
    challenge: 'J'.repeat(43),
    previousToken: null,
    now: authNow,
  })
  const authCeremony = await consumePasskeyCeremony(db, {
    token: 'E'.repeat(43),
    kind: 'authentication',
    now: authNow + 1,
  })
  const stored = await participantCredentialById(db, 'K'.repeat(43))
  assert.deepEqual(stored.transports, ['internal', 'hybrid'])
  await finishParticipantAuthentication(db, {
    ceremony: authCeremony,
    credential: stored,
    newCounter: 0,
    deviceType: 'multiDevice',
    backedUp: true,
    session: {
      tokenHash: await hashOpaqueToken('T'.repeat(43)),
      expiresAt: authNow + 60_000,
    },
    now: authNow + 2,
  })
  assert.equal(
    database.prepare('SELECT revision FROM participant_passkey_credential').get().revision,
    1,
  )
  assert.equal(
    database
      .prepare('SELECT COUNT(*) AS count FROM participant_session WHERE expires_at <= ?')
      .get(authNow + 2).count,
    0,
  )

  await beginAuthenticationCeremony(db, {
    fingerprint: `v1:${'c'.repeat(64)}`,
    ceremonyToken: 'F'.repeat(43),
    challenge: 'L'.repeat(43),
    previousToken: null,
    now: authNow + 100,
  })
  const nextCeremony = await consumePasskeyCeremony(db, {
    token: 'F'.repeat(43),
    kind: 'authentication',
    now: authNow + 101,
  })
  const current = await participantCredentialById(db, 'K'.repeat(43))
  await finishParticipantAuthentication(db, {
    ceremony: nextCeremony,
    credential: current,
    newCounter: 1,
    deviceType: 'multiDevice',
    backedUp: true,
    session: {
      tokenHash: await hashOpaqueToken('V'.repeat(43)),
      expiresAt: authNow + 70_000,
    },
    now: authNow + 102,
  })
  const sessionCount = database
    .prepare('SELECT COUNT(*) AS count FROM participant_session')
    .get().count
  await expectPasskeyError(
    async () =>
      finishParticipantAuthentication(db, {
        ceremony: nextCeremony,
        credential: current,
        newCounter: 1,
        deviceType: 'multiDevice',
        backedUp: true,
        session: {
          tokenHash: await hashOpaqueToken('W'.repeat(43)),
          expiresAt: authNow + 80_000,
        },
        now: authNow + 103,
      }),
    'conflict',
  )
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM participant_session').get().count,
    sessionCount,
  )

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await beginAuthenticationCeremony(db, {
      fingerprint: `v1:${'d'.repeat(64)}`,
      ceremonyToken: String(attempt).repeat(43),
      challenge: String(attempt + 1).repeat(43),
      previousToken: null,
      now: authNow + 200,
    })
  }
  await expectPasskeyError(
    () =>
      beginAuthenticationCeremony(db, {
        fingerprint: `v1:${'d'.repeat(64)}`,
        ceremonyToken: '6'.repeat(43),
        challenge: '7'.repeat(43),
        previousToken: null,
        now: authNow + 200,
      }),
    'rate_limited',
  )

  const racedInput = claimInput({
    managementToken: 'N'.repeat(43),
    ceremonyToken: 'R'.repeat(43),
    challenge: 'Z'.repeat(43),
    principalId: `p_${'X'.repeat(43)}`,
    userHandle: 'Y'.repeat(43),
    fingerprint: `v1:${'e'.repeat(64)}`,
    now: authNow + 300,
  })
  await beginClaimCeremony(db, racedInput)
  const racedCeremony = await consumePasskeyCeremony(db, {
    token: racedInput.ceremonyToken,
    kind: 'claim',
    now: racedInput.now + 1,
  })
  const otherPrincipal = `p_${'O'.repeat(43)}`
  database
    .prepare('INSERT INTO participant_principal (id, webauthn_user_handle) VALUES (?, ?)')
    .run(otherPrincipal, 'G'.repeat(43))
  database
    .prepare('INSERT INTO tournament_entry_owner (team_id, principal_id) VALUES (11, ?)')
    .run(otherPrincipal)
  await expectPasskeyError(
    async () =>
      finishParticipantClaim(db, {
        ceremony: racedCeremony,
        credential: {
          id: 'B'.repeat(43),
          publicKey: 'A'.repeat(43),
          counter: 0,
          transports: ['internal'],
          deviceType: 'singleDevice',
          backedUp: false,
        },
        session: {
          tokenHash: await hashOpaqueToken('Z'.repeat(43)),
          expiresAt: racedInput.now + 60_000,
        },
        now: racedInput.now + 2,
      }),
    'conflict',
  )
  assert.equal(
    database
      .prepare('SELECT COUNT(*) AS count FROM participant_principal WHERE id = ?')
      .get(racedInput.principalId).count,
    0,
  )
  assert.equal(
    database
      .prepare(
        'SELECT COUNT(*) AS count FROM participant_passkey_credential WHERE credential_id = ?',
      )
      .get('B'.repeat(43)).count,
    0,
  )

  assert.deepEqual(await participantAccessReceipt(db, claimInput().principalId, 'K'.repeat(43)), {
    credentialCreatedAt: claimInput().now + 3,
    credentialLastUsedAt: authNow + 102,
    deviceType: 'multiDevice',
    backedUp: true,
  })
  assert.equal(await participantAccessReceipt(db, otherPrincipal, 'K'.repeat(43)), null)

  console.log('participant passkey query tests passed')
} finally {
  database.close()
}

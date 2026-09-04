import assert from 'node:assert/strict'

import { hashOpaqueToken } from '../lib/opaque-token.ts'
import {
  beginAuthenticationCeremony,
  beginClaimCeremony,
  consumePasskeyCeremony,
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

const { database, db } = await createPasskeyQueryFixture()
const input = claimInput()

try {
  await beginClaimCeremony(db, input)
  const claim = await consumePasskeyCeremony(db, {
    token: input.ceremonyToken,
    kind: 'claim',
    now: input.now + 1,
  })
  const credentialId = 'cutover-credential'
  await finishParticipantClaim(db, {
    ceremony: claim,
    credential: {
      id: credentialId,
      publicKey: 'Q'.repeat(43),
      counter: 0,
      transports: ['internal'],
      deviceType: 'multiDevice',
      backedUp: true,
    },
    session: {
      tokenHash: await hashOpaqueToken('S'.repeat(43)),
      expiresAt: input.now + 60_000,
    },
    now: input.now + 2,
  })
  const authNow = input.now + 100
  await beginAuthenticationCeremony(db, {
    fingerprint: `v1:${'b'.repeat(64)}`,
    ceremonyToken: 'T'.repeat(43),
    challenge: 'V'.repeat(43),
    previousToken: null,
    now: authNow,
  })
  const ceremony = await consumePasskeyCeremony(db, {
    token: 'T'.repeat(43),
    kind: 'authentication',
    now: authNow + 1,
  })
  const credential = await participantCredentialById(db, credentialId)
  const sessionCount = database
    .prepare('SELECT COUNT(*) AS count FROM participant_session')
    .get().count
  const accountId = 'A'.repeat(43)
  database
    .prepare(
      `INSERT INTO identity_account
        (id, webauthn_user_handle, display_name, status, verification_state,
         created_at, updated_at)
       VALUES (?, ?, 'Migrated participant', 'active', 'legacy_unverified', ?, ?)`,
    )
    .run(accountId, input.userHandle, authNow, authNow)
  database
    .prepare(
      `INSERT INTO identity_legacy_subject_map
        (subject_type, subject_id, account_id, source_revision, source_snapshot_hash,
         migration_version, mapped_at)
       VALUES ('participant_principal', ?, ?, 0, ?, 1, ?)`,
    )
    .run(input.principalId, accountId, 'a'.repeat(64), authNow)

  await expectPasskeyError(() => participantCredentialById(db, credentialId), 'unknown_credential')
  await expectPasskeyError(
    async () =>
      finishParticipantAuthentication(db, {
        ceremony,
        credential,
        newCounter: 1,
        deviceType: 'multiDevice',
        backedUp: true,
        session: {
          tokenHash: await hashOpaqueToken('U'.repeat(43)),
          expiresAt: authNow + 60_000,
        },
        now: authNow + 2,
      }),
    'conflict',
  )
  assert.equal(
    database.prepare('SELECT revision FROM participant_passkey_credential').get().revision,
    0,
  )
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM participant_session').get().count,
    sessionCount,
  )
  console.log('legacy participant cutover authentication tests passed')
} finally {
  database.close()
}

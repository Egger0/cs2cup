import {
  expectDatabaseError,
  insertCredential,
  passkeyFixture,
} from './participant-passkey-schema-fixture.mjs'

export function testParticipantPasskeyCredentialSchema(database) {
  const { alpha, bravo, missing, alphaCredential, bravoCredential } = passkeyFixture
  insertCredential(database)
  insertCredential(database, {
    id: bravoCredential,
    principal: bravo,
    publicKey: 'public_key-bravo_1',
    counter: 7,
    transports: '["usb"]',
    deviceType: 'singleDevice',
  })

  expectDatabaseError(
    () => insertCredential(database, { principal: bravo }),
    'UNIQUE constraint failed',
  )
  expectDatabaseError(
    () => insertCredential(database, { id: 'missing-principal', principal: missing }),
    'FOREIGN KEY constraint failed',
  )
  for (const invalid of [
    { id: 'invalid/key=', publicKey: 'public_key' },
    { id: 'invalid-json', transports: '{}' },
    { id: 'invalid-device', deviceType: 'platform' },
    { id: 'invalid-backup', backedUp: 2 },
    { id: 'invalid-counter', counter: -1 },
  ]) {
    expectDatabaseError(() => insertCredential(database, invalid), 'CHECK constraint failed')
  }

  expectDatabaseError(
    () =>
      database
        .prepare('UPDATE participant_passkey_credential SET counter = 1 WHERE credential_id = ?')
        .run(alphaCredential),
    'passkey credential revision conflict',
  )
  const nonce = 'N'.repeat(43)
  const update = database.prepare(`
    UPDATE participant_passkey_credential
    SET counter = ?, revision = ?, write_nonce = ?, last_used_at = ?
    WHERE credential_id = ?
  `)
  update.run(1, 1, nonce, 2_000, alphaCredential)
  expectDatabaseError(
    () => update.run(1, 1, nonce, 2_000, alphaCredential),
    'passkey credential revision conflict',
  )
  expectDatabaseError(
    () => update.run(0, 2, 'D'.repeat(43), 3_000, alphaCredential),
    'passkey credential revision conflict',
  )
  expectDatabaseError(
    () => update.run(7, 1, nonce, 2_000, bravoCredential),
    'UNIQUE constraint failed',
  )
  expectDatabaseError(
    () =>
      database
        .prepare(
          `
            UPDATE participant_passkey_credential
            SET principal_id = ?, revision = 1, write_nonce = ?, last_used_at = 2_000
            WHERE credential_id = ?
          `,
        )
        .run(alpha, 'E'.repeat(43), bravoCredential),
    'passkey credential revision conflict',
  )
}

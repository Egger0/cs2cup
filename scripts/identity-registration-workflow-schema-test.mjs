import assert from 'node:assert/strict'

import {
  account,
  createUnifiedIdentitySchemaFixture,
  hash,
  opaque,
} from './unified-identity-schema-fixture.mjs'

const { database, execute, expectError } = await createUnifiedIdentitySchemaFixture()

try {
  expectError(() =>
    execute(
      `INSERT INTO identity_registration_draft
        (account_id, tournament_id, payload_json, created_at, updated_at)
       VALUES (?, 91, 'not-json', 100, 100)`,
      [account.alpha],
    ),
  )
  execute(
    `INSERT INTO identity_registration_draft
      (account_id, tournament_id, payload_json, created_at, updated_at)
     VALUES (?, 91, '{"name":"Alpha"}', 100, 100)`,
    [account.alpha],
  )
  expectError(() =>
    execute(
      `UPDATE identity_registration_draft SET payload_json = '{"name":"Stale"}'
       WHERE account_id = ? AND tournament_id = 91`,
      [account.alpha],
    ),
  )
  execute(
    `UPDATE identity_registration_draft
     SET payload_json = '{"name":"Bravo"}', updated_at = 101,
         revision = 1, write_nonce = ?
     WHERE account_id = ? AND tournament_id = 91`,
    [opaque('d'), account.alpha],
  )

  execute(
    `INSERT INTO identity_registration_membership
      (id, team_id, account_id, relationship, granted_by_account_id, grant_reason, granted_at)
     VALUES (?, 91, ?, 'owner', ?, 'Workflow schema test', 100)`,
    [opaque('m'), account.alpha, account.alpha],
  )
  const invitationInsert = `INSERT INTO identity_registration_invitation
    (id, team_id, invited_account_id, relationship, inviter_account_id, created_at, expires_at)
   VALUES (?, 91, ?, 'owner', ?, 100, 1000)`
  expectError(
    () =>
      execute(
        `INSERT INTO identity_registration_invitation
          (id, team_id, invited_account_id, relationship, inviter_account_id,
           created_at, expires_at, accepted_at)
         VALUES (?, 91, ?, 'manager', ?, 100, 1000, 200)`,
        [opaque('f'), account.bravo, account.alpha],
      ),
    /start fresh/,
  )
  execute(invitationInsert, [opaque('i'), account.bravo, account.alpha])
  expectError(() => execute(invitationInsert, [opaque('j'), account.bravo, account.alpha]))
  expectError(() => execute(invitationInsert, [opaque('k'), account.charlie, account.alpha]))
  execute(
    `UPDATE identity_registration_invitation
     SET accepted_at = 200, revision = 1, write_nonce = ? WHERE id = ?`,
    [opaque('n'), opaque('i')],
  )
  expectError(() =>
    execute(
      `UPDATE identity_registration_invitation
       SET accepted_at = 201, revision = 2, write_nonce = ? WHERE id = ?`,
      [opaque('o'), opaque('i')],
    ),
  )

  expectError(() =>
    execute(
      `INSERT INTO identity_registration_token_redemption
        (token_hash, team_id, account_id, redeemed_at, replay_expires_at)
       VALUES (?, 91, ?, 100, 900101)`,
      [hash('1'), account.alpha],
    ),
  )
  execute(
    `INSERT INTO identity_registration_token_redemption
      (token_hash, team_id, account_id, redeemed_at, replay_expires_at)
     VALUES (?, 91, ?, 100, 900100)`,
    [hash('1'), account.alpha],
  )
  expectError(() =>
    execute(
      `INSERT INTO identity_registration_token_redemption
        (token_hash, team_id, account_id, redeemed_at, replay_expires_at)
       VALUES (?, 91, ?, 100, 1000)`,
      [hash('2'), account.alpha],
    ),
  )

  assert.equal(
    database.prepare('SELECT revision FROM identity_registration_draft').get().revision,
    1,
  )
  console.log('identity registration workflow schema tests passed')
} finally {
  database.close()
}

import {
  account,
  createUnifiedIdentitySchemaFixture,
  hash,
} from './unified-identity-schema-fixture.mjs'

const { database, execute, expectError } = await createUnifiedIdentitySchemaFixture()

try {
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

  console.log('identity registration workflow schema tests passed')
} finally {
  database.close()
}

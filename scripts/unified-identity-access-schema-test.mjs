import assert from 'node:assert/strict'

import {
  account,
  createUnifiedIdentitySchemaFixture,
  hash,
  identity,
  identityKeyHash,
  opaque,
} from './unified-identity-schema-fixture.mjs'

const { database, execute, expectError } = await createUnifiedIdentitySchemaFixture()

try {
  assert.ok(
    database
      .prepare(
        "SELECT 1 FROM sqlite_schema WHERE type = 'index' AND name = 'identity_invitation_target_expiry_idx'",
      )
      .get(),
  )
  const membershipInsert = `INSERT INTO identity_registration_membership
    (id, team_id, account_id, relationship, granted_by_account_id, grant_reason, granted_at)
   VALUES (?, 91, ?, ?, ?, 'Initial grant', 100)`
  execute(membershipInsert, [opaque('M'), account.alpha, 'owner', account.alpha])
  expectError(() => execute(membershipInsert, [opaque('N'), account.bravo, 'owner', account.alpha]))
  execute(membershipInsert, [opaque('O'), account.bravo, 'manager', account.alpha])
  expectError(() =>
    execute(membershipInsert, [opaque('P'), account.bravo, 'manager', account.alpha]),
  )
  execute(
    `UPDATE identity_registration_membership
     SET revoked_at = 200, revoked_by_account_id = ?, revoke_reason = 'Access ended',
         revision = 1, write_nonce = ? WHERE id = ?`,
    [account.alpha, opaque('t'), opaque('O')],
  )
  execute(membershipInsert, [opaque('P'), account.bravo, 'manager', account.alpha])

  const roleInsert = `INSERT INTO identity_role_assignment
    (id, account_id, role, scope_type, scope_tournament_id, granted_by_account_id,
     grant_reason, granted_at)
   VALUES (?, ?, ?, ?, ?, ?, 'Operational access', 100)`
  execute(roleInsert, [
    opaque('R'),
    account.alpha,
    'platform_owner',
    'platform',
    null,
    account.alpha,
  ])
  expectError(() =>
    execute(roleInsert, [
      opaque('V'),
      account.alpha,
      'platform_owner',
      'platform',
      null,
      account.alpha,
    ]),
  )
  expectError(() =>
    execute(roleInsert, [opaque('W'), account.bravo, 'organizer', 'platform', null, account.alpha]),
  )
  execute(roleInsert, [opaque('X'), account.bravo, 'organizer', 'tournament', 91, account.alpha])

  const invitationInsert = `INSERT INTO identity_access_invitation
    (id, secret_hash, intended_provider, intended_issuer, intended_identity_key_hash,
     intended_display_hint, target_kind, role, relationship, scope_type, scope_tournament_id,
     scope_team_id, inviter_account_id, grant_reason, created_at, expires_at)
   VALUES (?, ?, 'campus', 'https://id.example/tenant-b', ?, 's***@example.edu', ?, ?, ?, ?, ?, ?,
           ?, 'Join this scope', 100, 1000)`
  const bravoIdentityKeyHash = identityKeyHash('campus', 'https://id.example/tenant-b', 'Student-1')
  execute(invitationInsert, [
    opaque('L'),
    hash('8'),
    bravoIdentityKeyHash,
    'registration_membership',
    null,
    'manager',
    'registration',
    null,
    91,
    account.alpha,
  ])
  expectError(() =>
    execute(invitationInsert, [
      opaque('Q'),
      hash('a'),
      bravoIdentityKeyHash,
      'registration_membership',
      null,
      'manager',
      'registration',
      null,
      91,
      account.alpha,
    ]),
  )
  expectError(
    () =>
      execute(
        `UPDATE identity_access_invitation
         SET accepted_at = 200, accepted_by_account_id = ?, accepted_verified_identity_id = ?,
             consume_nonce = ?, revision = 1, write_nonce = ? WHERE id = ?`,
        [account.bravo, identity.alpha, opaque('u'), opaque('v'), opaque('L')],
      ),
    /verified identity mismatch/,
  )
  expectError(
    () =>
      execute(
        `UPDATE identity_access_invitation
         SET accepted_at = 200, accepted_by_account_id = ?, accepted_verified_identity_id = ?,
             consume_nonce = ?, revision = 1, write_nonce = ? WHERE id = ?`,
        [account.charlie, identity.cas, opaque('u'), opaque('v'), opaque('L')],
      ),
    /verified identity mismatch/,
  )
  execute(
    `UPDATE identity_access_invitation
     SET accepted_at = 200, accepted_by_account_id = ?, accepted_verified_identity_id = ?,
         consume_nonce = ?, revision = 1, write_nonce = ? WHERE id = ?`,
    [account.bravo, identity.bravo, opaque('u'), opaque('v'), opaque('L')],
  )

  const expiredInvitationInsert = `INSERT INTO identity_access_invitation
    (id, secret_hash, intended_provider, intended_issuer, intended_identity_key_hash,
     intended_display_hint, target_kind, relationship, scope_type, scope_team_id,
     inviter_account_id, grant_reason, created_at, expires_at)
   VALUES (?, ?, 'campus', 'https://id.example/tenant-a', ?, 's***@example.edu',
           'registration_membership', 'manager', 'registration', 91, ?,
           'Expiry replacement test', ?, ?)`
  const alphaIdentityKeyHash = identityKeyHash('campus', 'https://id.example/tenant-a', 'Student-1')
  execute(expiredInvitationInsert, [
    opaque('Q'),
    hash('a'),
    alphaIdentityKeyHash,
    account.alpha,
    100,
    1000,
  ])
  expectError(() =>
    execute(expiredInvitationInsert, [
      opaque('V'),
      hash('c'),
      alphaIdentityKeyHash,
      account.alpha,
      1100,
      2000,
    ]),
  )
  execute(
    `UPDATE identity_access_invitation
     SET revoked_at = 1100, revoked_by_account_id = ?, revoke_reason = 'Expired before reissue',
         revision = 1, write_nonce = ? WHERE id = ?`,
    [account.alpha, opaque('B'), opaque('Q')],
  )
  execute(expiredInvitationInsert, [
    opaque('V'),
    hash('c'),
    alphaIdentityKeyHash,
    account.alpha,
    1100,
    2000,
  ])

  execute(
    `INSERT INTO identity_access_invitation
      (id, secret_hash, intended_provider, intended_issuer, intended_identity_key_hash,
       intended_display_hint, target_kind, relationship, scope_type, scope_team_id,
       inviter_account_id, grant_reason, created_at, expires_at)
     VALUES (?, ?, 'campus-cas', 'https://cas.example', ?, 's***2',
             'registration_membership', 'manager', 'registration', 91, ?,
             'Revoked identity test', 100, 1000)`,
    [
      opaque('W'),
      hash('d'),
      identityKeyHash('campus-cas', 'https://cas.example', 'Student-2'),
      account.alpha,
    ],
  )
  execute(
    `UPDATE identity_verified_identity
     SET status = 'revoked', revoked_at = 300, revision = 1, write_nonce = ? WHERE id = ?`,
    [opaque('C'), identity.cas],
  )
  expectError(
    () =>
      execute(
        `UPDATE identity_access_invitation
         SET accepted_at = 400, accepted_by_account_id = ?, accepted_verified_identity_id = ?,
             consume_nonce = ?, revision = 1, write_nonce = ? WHERE id = ?`,
        [account.charlie, identity.cas, opaque('D'), opaque('E'), opaque('W')],
      ),
    /verified identity mismatch/,
  )

  console.log('unified identity access schema tests passed')
} finally {
  database.close()
}

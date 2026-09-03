import {
  account,
  createUnifiedIdentitySchemaFixture,
  hash,
  opaque,
} from './unified-identity-schema-fixture.mjs'

export { account, hash, opaque }

export const moderated = {
  registrationId: opaque('I'),
  applicationId: opaque('J'),
  reviewId: opaque('K'),
  membershipId: opaque('M'),
  accountId: opaque('P'),
  credentialId: opaque('Q'),
  reviewerAccountId: account.charlie,
  reviewerSessionId: opaque('Y'),
  requestProofHash: hash('1'),
  username: 'player.one',
}

export async function createModeratedIdentityFixture() {
  const fixture = await createUnifiedIdentitySchemaFixture()
  const { execute } = fixture

  execute(
    `INSERT INTO identity_role_assignment
      (id, account_id, role, scope_type, grant_reason, granted_at)
     VALUES (?, ?, 'identity_reviewer', 'platform', 'Identity queue reviewer', 100)`,
    [opaque('R'), moderated.reviewerAccountId],
  )

  const insertSelfRegistration = ({
    id = moderated.registrationId,
    requestProofHash = moderated.requestProofHash,
    accountId = moderated.accountId,
    username = moderated.username,
    displayName = 'Player One',
  } = {}) =>
    execute(
      `INSERT INTO identity_self_registration
        (id, request_proof_hash, expected_account_id, requested_username,
         requested_display_name, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 150, 750)`,
      [id, requestProofHash, accountId, username, displayName],
    )

  const createActiveAccount = ({ displayName = 'Player One' } = {}) =>
    execute(
      `INSERT INTO identity_account
        (id, webauthn_user_handle, display_name, status, verification_state, created_at, updated_at)
       VALUES (?, ?, ?, 'active', 'legacy_unverified', 160, 160)`,
      [moderated.accountId, opaque('p'), displayName],
    )

  const createPasswordCredential = ({ username = moderated.username } = {}) =>
    execute(
      `INSERT INTO identity_password_credential
        (id, account_id, username, algorithm, parameters_json, salt, password_hash,
         pepper_version, registration_kind, self_registration_id, created_at, updated_at)
       VALUES (?, ?, ?, 'argon2id', '{"m":65536,"t":3,"p":1}', ?, ?, 1,
         'self_registration', ?, 170, 170)`,
      [
        moderated.credentialId,
        moderated.accountId,
        username,
        Buffer.alloc(16, 1),
        Buffer.alloc(32, 2),
        moderated.registrationId,
      ],
    )

  const consumeSelfRegistration = () =>
    execute(
      `UPDATE identity_self_registration
       SET consumed_at = 180, consume_nonce = ?, password_credential_id = ?
       WHERE id = ?`,
      [opaque('S'), moderated.credentialId, moderated.registrationId],
    )

  const registerPasswordAccount = () => {
    insertSelfRegistration()
    createActiveAccount()
    createPasswordCredential()
    consumeSelfRegistration()
  }

  return {
    ...fixture,
    insertSelfRegistration,
    createActiveAccount,
    createPasswordCredential,
    consumeSelfRegistration,
    registerPasswordAccount,
  }
}

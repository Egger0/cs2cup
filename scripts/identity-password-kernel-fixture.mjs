import { randomBytes } from 'node:crypto'

export function installPasswordKernelFixture({
  database,
  execute,
  now,
  accountIds,
  passwordCredentialIds,
}) {
  // Enrollment provenance has its own schema suite. Authorization tests bypass only these
  // enrollment insert guards, then retain the real credential CAS and session proof guards.
  database.exec(`
    DROP TRIGGER identity_self_registration_fresh_insert_guard;
    DROP TRIGGER identity_password_credential_fresh_insert_guard;
  `)

  const insertCredential = (accountId, credentialId, username) => {
    const registrationId = randomBytes(32).toString('base64url')
    execute(
      `INSERT INTO identity_self_registration
        (id, request_proof_hash, expected_account_id, requested_username,
         requested_display_name, created_at, expires_at)
       VALUES (?, ?, ?, ?, 'Kernel fixture', ?, ?)`,
      [
        registrationId,
        randomBytes(32).toString('hex'),
        accountId,
        username,
        now - 50_400_000,
        now - 49_800_000,
      ],
    )
    execute(
      `INSERT INTO identity_password_credential
        (id, account_id, username, algorithm, parameters_json, salt, password_hash,
         pepper_version, registration_kind, self_registration_id, created_at, updated_at)
       VALUES (?, ?, ?, 'argon2id', '{"m":65536,"t":3,"p":1}', ?, ?, 1,
         'self_registration', ?, ?, ?)`,
      [
        credentialId,
        accountId,
        username,
        Buffer.alloc(16, 1),
        Buffer.alloc(32, 2),
        registrationId,
        now - 50_400_000,
        now - 50_400_000,
      ],
    )
  }
  insertCredential(accountIds.weakStaff, passwordCredentialIds.weakStaff, 'staff.user')
  insertCredential(accountIds.reviewer, passwordCredentialIds.reviewer, 'reviewer.user')

  return function createPasswordProof(accountId, credentialId, authenticatedAt = now) {
    const credential = database
      .prepare(
        `SELECT revision FROM identity_password_credential
         WHERE id = ? AND account_id = ? AND status = 'active'`,
      )
      .get(credentialId, accountId)
    if (!credential) throw new Error('Fixture password credential is unavailable')
    const verificationNonce = randomBytes(32).toString('base64url')
    const updated = execute(
      `UPDATE identity_password_credential
       SET failed_attempt_count = 0, last_failed_at = NULL, locked_until = NULL,
           last_authenticated_at = ?, updated_at = ?, revision = revision + 1, write_nonce = ?
       WHERE id = ? AND account_id = ? AND revision = ?
         AND (last_authenticated_at IS NULL OR last_authenticated_at < ?)`,
      [
        authenticatedAt,
        authenticatedAt,
        verificationNonce,
        credentialId,
        accountId,
        credential.revision,
        authenticatedAt,
      ],
    )
    if (updated.changes !== 1) throw new Error('Fixture password verification CAS failed')
    return verificationNonce
  }
}

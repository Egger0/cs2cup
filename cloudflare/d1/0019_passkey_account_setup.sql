CREATE TABLE identity_passkey_account_setup (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (length(id) = 43 AND id NOT GLOB '*[^A-Za-z0-9_-]*'),
  account_id TEXT NOT NULL UNIQUE COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  initiating_session_id TEXT NOT NULL UNIQUE COLLATE BINARY
    REFERENCES identity_session(id) ON DELETE RESTRICT,
  requested_username TEXT NOT NULL UNIQUE COLLATE BINARY
    CHECK (
      length(requested_username) BETWEEN 3 AND 32
      AND requested_username = lower(trim(requested_username))
      AND requested_username GLOB '[a-z0-9]*'
      AND substr(requested_username, -1, 1) GLOB '[a-z0-9]'
      AND requested_username NOT GLOB '*[^a-z0-9_.-]*'
      AND requested_username NOT IN (
        'account', 'admin', 'administrator', 'api', 'auth', 'cs2cup', 'help', 'login',
        'moderator', 'nbt', 'nlc', 'null', 'owner', 'root', 'security', 'staff',
        'support', 'system', 'undefined'
      )
    ),
  created_at INTEGER NOT NULL
    CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  expires_at INTEGER NOT NULL
    CHECK (
      typeof(expires_at) = 'integer'
      AND expires_at = created_at + 600000
    ),
  consumed_at INTEGER
    CHECK (
      consumed_at IS NULL
      OR (typeof(consumed_at) = 'integer' AND consumed_at BETWEEN created_at AND expires_at - 1)
    ),
  consume_nonce TEXT UNIQUE COLLATE BINARY
    CHECK (
      consume_nonce IS NULL
      OR (length(consume_nonce) = 43 AND consume_nonce NOT GLOB '*[^A-Za-z0-9_-]*')
    ),
  password_credential_id TEXT UNIQUE COLLATE BINARY
    REFERENCES identity_password_credential(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(revision) = 'integer' AND revision >= 0),
  write_nonce TEXT UNIQUE COLLATE BINARY
    CHECK (
      write_nonce IS NULL
      OR (length(write_nonce) = 43 AND write_nonce NOT GLOB '*[^A-Za-z0-9_-]*')
    ),
  CHECK (
    (consumed_at IS NULL AND consume_nonce IS NULL AND password_credential_id IS NULL)
    OR (consumed_at IS NOT NULL AND consume_nonce IS NOT NULL AND password_credential_id IS NOT NULL)
  )
);

CREATE TRIGGER identity_passkey_account_setup_fresh_insert_guard
BEFORE INSERT ON identity_passkey_account_setup
WHEN NEW.consumed_at IS NOT NULL
  OR NEW.consume_nonce IS NOT NULL
  OR NEW.password_credential_id IS NOT NULL
  OR NEW.revision != 0
  OR NEW.write_nonce IS NOT NULL
  OR NOT EXISTS (
    SELECT 1
    FROM identity_session AS session
    JOIN identity_account AS account ON account.id = session.account_id
    JOIN identity_passkey_credential AS passkey
      ON passkey.credential_id = session.authenticator_credential_id
     AND passkey.account_id = session.account_id
    JOIN identity_legacy_subject_map AS legacy
      ON legacy.account_id = account.id
     AND legacy.subject_type = 'participant_principal'
    JOIN identity_cutover AS cutover ON cutover.account_id = account.id
    WHERE session.id = NEW.initiating_session_id
      AND session.account_id = NEW.account_id
      AND session.auth_method = 'passkey'
      AND session.revoked_at IS NULL
      AND session.recovery_restricted = 0
      AND session.security_version = account.security_version
      AND session.created_at <= NEW.created_at
      AND session.authenticated_at BETWEEN NEW.created_at - 900000 AND NEW.created_at
      AND session.phishing_resistant_at BETWEEN NEW.created_at - 900000 AND NEW.created_at
      AND session.idle_expires_at > NEW.created_at
      AND session.absolute_expires_at > NEW.created_at
      AND account.status = 'active'
      AND account.verification_state = 'legacy_unverified'
      AND passkey.status = 'active'
      AND cutover.cohort_key = 'legacy_participant'
      AND cutover.phase = 3
      AND NOT EXISTS (
        SELECT 1 FROM identity_password_credential AS password
        WHERE password.account_id = account.id
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'account setup requires a recent migrated passkey session');
END;

CREATE TRIGGER identity_passkey_account_setup_update_guard
BEFORE UPDATE ON identity_passkey_account_setup
WHEN NEW.id IS NOT OLD.id
  OR NEW.account_id IS NOT OLD.account_id
  OR NEW.initiating_session_id IS NOT OLD.initiating_session_id
  OR NEW.requested_username IS NOT OLD.requested_username
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.expires_at IS NOT OLD.expires_at
  OR OLD.consumed_at IS NOT NULL
  OR NEW.consumed_at IS NULL
  OR NEW.consume_nonce IS NULL
  OR NEW.password_credential_id IS NULL
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
  OR NOT EXISTS (
    SELECT 1
    FROM identity_self_registration AS registration
    JOIN identity_password_credential AS credential
      ON credential.id = registration.password_credential_id
    JOIN identity_session AS session ON session.id = OLD.initiating_session_id
    JOIN identity_account AS account ON account.id = session.account_id
    JOIN identity_passkey_credential AS passkey
      ON passkey.credential_id = session.authenticator_credential_id
     AND passkey.account_id = session.account_id
    WHERE registration.id = OLD.id
      AND registration.expected_account_id = OLD.account_id
      AND registration.requested_username = OLD.requested_username
      AND registration.consumed_at = NEW.consumed_at
      AND registration.consume_nonce = NEW.consume_nonce
      AND credential.id = NEW.password_credential_id
      AND credential.account_id = OLD.account_id
      AND credential.username = OLD.requested_username
      AND credential.status = 'active'
      AND session.account_id = OLD.account_id
      AND session.auth_method = 'passkey'
      AND session.revoked_at IS NULL
      AND session.recovery_restricted = 0
      AND session.security_version = account.security_version
      AND session.authenticated_at BETWEEN NEW.consumed_at - 900000 AND NEW.consumed_at
      AND session.phishing_resistant_at BETWEEN NEW.consumed_at - 900000 AND NEW.consumed_at
      AND session.idle_expires_at > NEW.consumed_at
      AND session.absolute_expires_at > NEW.consumed_at
      AND account.status = 'active'
      AND passkey.status = 'active'
  )
BEGIN
  SELECT RAISE(ABORT, 'account setup consumption conflict');
END;

CREATE TRIGGER identity_passkey_account_setup_delete_guard
BEFORE DELETE ON identity_passkey_account_setup
BEGIN
  SELECT RAISE(ABORT, 'account setup records are retained');
END;

CREATE TRIGGER identity_passkey_account_setup_insert_conflict_guard
BEFORE INSERT ON identity_passkey_account_setup
WHEN EXISTS (
  SELECT 1 FROM identity_passkey_account_setup AS existing
  WHERE existing.id = NEW.id
    OR existing.account_id = NEW.account_id
    OR existing.initiating_session_id = NEW.initiating_session_id
    OR existing.requested_username = NEW.requested_username
    OR (NEW.consume_nonce IS NOT NULL AND existing.consume_nonce = NEW.consume_nonce)
    OR (NEW.password_credential_id IS NOT NULL
      AND existing.password_credential_id = NEW.password_credential_id)
    OR (NEW.write_nonce IS NOT NULL AND existing.write_nonce = NEW.write_nonce)
)
BEGIN
  SELECT RAISE(ABORT, 'account setup insert conflict');
END;

DROP TRIGGER identity_self_registration_fresh_insert_guard;

CREATE TRIGGER identity_self_registration_fresh_insert_guard
BEFORE INSERT ON identity_self_registration
WHEN NEW.consumed_at IS NOT NULL
  OR NEW.consume_nonce IS NOT NULL
  OR NEW.password_credential_id IS NOT NULL
  OR (
    EXISTS (SELECT 1 FROM identity_account WHERE id = NEW.expected_account_id)
    AND NOT EXISTS (
      SELECT 1
      FROM identity_passkey_account_setup AS setup
      JOIN identity_session AS session ON session.id = setup.initiating_session_id
      JOIN identity_account AS account ON account.id = setup.account_id
      WHERE setup.id = NEW.id
        AND setup.account_id = NEW.expected_account_id
        AND setup.requested_username = NEW.requested_username
        AND setup.created_at = NEW.created_at
        AND setup.expires_at = NEW.expires_at
        AND setup.consumed_at IS NULL
        AND NEW.requested_display_name = account.display_name
        AND session.account_id = account.id
        AND session.auth_method = 'passkey'
        AND session.revoked_at IS NULL
        AND session.recovery_restricted = 0
        AND session.security_version = account.security_version
        AND session.authenticated_at BETWEEN NEW.created_at - 900000 AND NEW.created_at
        AND session.phishing_resistant_at BETWEEN NEW.created_at - 900000 AND NEW.created_at
        AND session.idle_expires_at > NEW.created_at
        AND session.absolute_expires_at > NEW.created_at
        AND account.status = 'active'
        AND account.verification_state = 'legacy_unverified'
        AND NOT EXISTS (
          SELECT 1 FROM identity_password_credential AS password
          WHERE password.account_id = account.id
        )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'self registration must start fresh');
END;

CREATE TRIGGER identity_passkey_credential_last_login_guard
BEFORE UPDATE OF status ON identity_passkey_credential
WHEN OLD.status = 'active'
  AND NEW.status = 'revoked'
  AND NOT EXISTS (
    SELECT 1 FROM identity_password_credential AS password
    WHERE password.account_id = OLD.account_id AND password.status = 'active'
  )
  AND NOT EXISTS (
    SELECT 1 FROM identity_passkey_credential AS passkey
    WHERE passkey.account_id = OLD.account_id
      AND passkey.status = 'active'
      AND passkey.credential_id != OLD.credential_id
  )
BEGIN
  SELECT RAISE(ABORT, 'cannot revoke the last login credential');
END;

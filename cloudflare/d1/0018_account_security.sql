DROP TRIGGER identity_recovery_code_set_fresh_insert_guard;
DROP TRIGGER identity_recovery_code_set_activation_guard;
DROP TRIGGER identity_recovery_code_consume_guard;
DROP TRIGGER identity_passkey_enrollment_authorization_insert_guard;

CREATE TRIGGER identity_recovery_code_set_fresh_insert_guard
BEFORE INSERT ON identity_recovery_code_set
WHEN NEW.status != 'building'
  OR NEW.activated_at IS NOT NULL
  OR NEW.closed_at IS NOT NULL
  OR NEW.revision != 0
  OR NEW.write_nonce IS NOT NULL
  OR NOT EXISTS (
    SELECT 1 FROM identity_account
    WHERE id = NEW.account_id AND status = 'active'
  )
BEGIN
  SELECT RAISE(ABORT, 'recovery code set must start fresh for an active account');
END;

CREATE TRIGGER identity_recovery_code_set_activation_guard
BEFORE UPDATE ON identity_recovery_code_set
WHEN OLD.status = 'building'
  AND NEW.status = 'active'
  AND (
    NOT EXISTS (
      SELECT 1 FROM identity_account
      WHERE id = OLD.account_id AND status = 'active'
    )
    OR (
      SELECT COUNT(*) FROM identity_recovery_code WHERE set_id = OLD.id
    ) != OLD.code_count
  )
BEGIN
  SELECT RAISE(ABORT, 'recovery code set is incomplete or account is unavailable');
END;

CREATE TRIGGER identity_recovery_code_consume_guard
BEFORE UPDATE ON identity_recovery_code
WHEN NEW.id IS NOT OLD.id
  OR NEW.set_id IS NOT OLD.set_id
  OR NEW.ordinal IS NOT OLD.ordinal
  OR NEW.verifier IS NOT OLD.verifier
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
  OR OLD.consumed_at IS NOT NULL
  OR NEW.consumed_at IS NULL
  OR NEW.consumed_auth_intent_id IS NULL
  OR NEW.consume_nonce IS NULL
  OR NOT EXISTS (
    SELECT 1
    FROM identity_recovery_code_set AS code_set
    JOIN identity_account AS account ON account.id = code_set.account_id
    JOIN identity_auth_intent AS recovery_intent
      ON recovery_intent.id = NEW.consumed_auth_intent_id
    WHERE code_set.id = OLD.set_id
      AND code_set.status = 'active'
      AND account.status = 'active'
      AND recovery_intent.purpose = 'recovery'
      AND recovery_intent.expected_account_id = code_set.account_id
      AND recovery_intent.consumed_at IS NULL
      AND recovery_intent.attempt_count < recovery_intent.max_attempts
      AND recovery_intent.created_at <= NEW.consumed_at
      AND recovery_intent.expires_at > NEW.consumed_at
  )
BEGIN
  SELECT RAISE(ABORT, 'recovery code consumption conflict');
END;

CREATE TRIGGER identity_passkey_enrollment_authorization_insert_guard
BEFORE INSERT ON identity_passkey_enrollment_authorization
WHEN NOT EXISTS (
  SELECT 1
  FROM identity_auth_intent AS enrollment_intent
  JOIN identity_session AS initiating_session
    ON initiating_session.id = NEW.initiating_session_id
   AND initiating_session.account_id = NEW.account_id
  JOIN identity_account AS account ON account.id = NEW.account_id
  WHERE enrollment_intent.id = NEW.auth_intent_id
    AND enrollment_intent.purpose = 'passkey_enrollment'
    AND enrollment_intent.expected_account_id = NEW.account_id
    AND enrollment_intent.consumed_at IS NULL
    AND enrollment_intent.created_at <= NEW.authorized_at
    AND enrollment_intent.expires_at > NEW.authorized_at
    AND initiating_session.revoked_at IS NULL
    AND initiating_session.recovery_restricted = 0
    AND initiating_session.security_version = account.security_version
    AND initiating_session.created_at <= NEW.authorized_at
    AND initiating_session.authenticated_at >= NEW.authorized_at - 900000
    AND initiating_session.idle_expires_at > NEW.authorized_at
    AND initiating_session.absolute_expires_at > NEW.authorized_at
    AND account.status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'passkey enrollment requires recent authentication');
END;

DROP TRIGGER identity_password_change_authority_guard;
DROP TRIGGER identity_password_change_update_guard;
DROP TRIGGER identity_password_change_delete_guard;
DROP TRIGGER identity_password_change_insert_conflict_guard;
DROP TRIGGER identity_password_credential_update_guard;
DROP TRIGGER identity_password_credential_secret_rotation;
DROP INDEX identity_password_change_account_idx;
DROP INDEX identity_password_change_credential_idx;

CREATE TABLE identity_password_change_credential_link (
  credential_id TEXT PRIMARY KEY NOT NULL COLLATE BINARY,
  password_change_id TEXT NOT NULL UNIQUE COLLATE BINARY
);

INSERT INTO identity_password_change_credential_link (credential_id, password_change_id)
SELECT id, last_change_id
FROM identity_password_credential
WHERE last_change_id IS NOT NULL;

UPDATE identity_password_credential
SET last_change_id = NULL
WHERE last_change_id IS NOT NULL;

CREATE TABLE identity_password_change_with_recovery_code (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (length(id) = 43 AND id NOT GLOB '*[^A-Za-z0-9_-]*'),
  credential_id TEXT NOT NULL COLLATE BINARY,
  account_id TEXT NOT NULL COLLATE BINARY,
  change_kind TEXT NOT NULL COLLATE BINARY
    CHECK (change_kind IN ('authenticated_change', 'recovery_code', 'assisted_recovery')),
  authorizing_session_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_session(id) ON DELETE RESTRICT,
  confirmation_auth_intent_id TEXT UNIQUE COLLATE BINARY
    REFERENCES identity_auth_intent(id) ON DELETE RESTRICT,
  assisted_recovery_case_id TEXT UNIQUE COLLATE BINARY
    REFERENCES identity_assisted_recovery_case(id) ON DELETE RESTRICT,
  from_secret_version INTEGER NOT NULL
    CHECK (typeof(from_secret_version) = 'integer' AND from_secret_version >= 1),
  to_secret_version INTEGER NOT NULL
    CHECK (typeof(to_secret_version) = 'integer' AND to_secret_version = from_secret_version + 1),
  target_security_version INTEGER NOT NULL
    CHECK (typeof(target_security_version) = 'integer' AND target_security_version >= 1),
  changed_at INTEGER NOT NULL
    CHECK (typeof(changed_at) = 'integer' AND changed_at >= 0),
  request_correlation_id TEXT NOT NULL COLLATE BINARY
    CHECK (
      length(request_correlation_id) BETWEEN 16 AND 128
      AND request_correlation_id NOT GLOB '*[^A-Za-z0-9_.:-]*'
    ),
  FOREIGN KEY (credential_id, account_id)
    REFERENCES identity_password_credential(id, account_id) ON DELETE RESTRICT,
  CHECK (
    (change_kind = 'authenticated_change'
      AND confirmation_auth_intent_id IS NOT NULL
      AND assisted_recovery_case_id IS NULL)
    OR
    (change_kind = 'recovery_code'
      AND confirmation_auth_intent_id IS NOT NULL
      AND assisted_recovery_case_id IS NULL)
    OR
    (change_kind = 'assisted_recovery'
      AND confirmation_auth_intent_id IS NULL
      AND assisted_recovery_case_id IS NOT NULL)
  )
);

INSERT INTO identity_password_change_with_recovery_code (
  id, credential_id, account_id, change_kind, authorizing_session_id,
  confirmation_auth_intent_id, assisted_recovery_case_id, from_secret_version,
  to_secret_version, target_security_version, changed_at, request_correlation_id
)
SELECT
  id, credential_id, account_id, change_kind, authorizing_session_id,
  confirmation_auth_intent_id, assisted_recovery_case_id, from_secret_version,
  to_secret_version, target_security_version, changed_at, request_correlation_id
FROM identity_password_change;

DROP TABLE identity_password_change;

ALTER TABLE identity_password_change_with_recovery_code RENAME TO identity_password_change;

UPDATE identity_password_credential
SET last_change_id = (
  SELECT password_change_id
  FROM identity_password_change_credential_link AS link
  WHERE link.credential_id = identity_password_credential.id
)
WHERE id IN (SELECT credential_id FROM identity_password_change_credential_link);

DROP TABLE identity_password_change_credential_link;

CREATE INDEX identity_password_change_account_idx
ON identity_password_change(account_id, changed_at DESC);

CREATE INDEX identity_password_change_credential_idx
ON identity_password_change(credential_id, changed_at DESC);

CREATE TRIGGER identity_password_credential_update_guard
BEFORE UPDATE ON identity_password_credential
WHEN NEW.id IS NOT OLD.id
  OR NEW.account_id IS NOT OLD.account_id
  OR NEW.username IS NOT OLD.username
  OR NEW.registration_kind IS NOT OLD.registration_kind
  OR NEW.self_registration_id IS NOT OLD.self_registration_id
  OR NEW.legacy_admin_bootstrap_id IS NOT OLD.legacy_admin_bootstrap_id
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.updated_at < OLD.updated_at
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
  OR OLD.status != 'active'
  OR NOT (
    (
      NEW.status = 'active'
      AND NEW.secret_version = OLD.secret_version + 1
      AND NEW.last_change_id IS NOT NULL
      AND NEW.last_change_id IS NOT OLD.last_change_id
      AND NEW.failed_attempt_count = 0
      AND NEW.last_failed_at IS NULL
      AND NEW.locked_until IS NULL
      AND NEW.last_authenticated_at IS OLD.last_authenticated_at
      AND NEW.revoked_at IS NULL
      AND EXISTS (
        SELECT 1 FROM identity_password_change AS password_change
        WHERE password_change.id = NEW.last_change_id
          AND password_change.credential_id = OLD.id
          AND password_change.account_id = OLD.account_id
          AND password_change.from_secret_version = OLD.secret_version
          AND password_change.to_secret_version = NEW.secret_version
          AND password_change.changed_at = NEW.updated_at
      )
    )
    OR
    (
      NEW.status = 'active'
      AND NEW.secret_version = OLD.secret_version
      AND NEW.algorithm IS OLD.algorithm
      AND NEW.parameters_json IS OLD.parameters_json
      AND NEW.salt IS OLD.salt
      AND NEW.password_hash IS OLD.password_hash
      AND NEW.pepper_version = OLD.pepper_version
      AND NEW.last_change_id IS OLD.last_change_id
      AND NEW.revoked_at IS NULL
      AND (
        (NEW.failed_attempt_count = OLD.failed_attempt_count + 1
          AND NEW.last_failed_at IS NOT NULL
          AND (OLD.last_failed_at IS NULL OR NEW.last_failed_at >= OLD.last_failed_at)
          AND NEW.last_authenticated_at IS OLD.last_authenticated_at
          AND (OLD.locked_until IS NULL OR NEW.locked_until >= OLD.locked_until))
        OR
        (NEW.failed_attempt_count = 0
          AND NEW.last_failed_at IS NULL
          AND NEW.locked_until IS NULL
          AND NEW.last_authenticated_at IS NOT NULL
          AND (OLD.last_authenticated_at IS NULL
            OR NEW.last_authenticated_at > OLD.last_authenticated_at))
      )
    )
    OR
    (
      NEW.status = 'revoked'
      AND NEW.revoked_at IS NOT NULL
      AND NEW.secret_version = OLD.secret_version
      AND NEW.algorithm IS OLD.algorithm
      AND NEW.parameters_json IS OLD.parameters_json
      AND NEW.salt IS OLD.salt
      AND NEW.password_hash IS OLD.password_hash
      AND NEW.pepper_version = OLD.pepper_version
      AND NEW.failed_attempt_count = OLD.failed_attempt_count
      AND NEW.last_failed_at IS OLD.last_failed_at
      AND NEW.locked_until IS OLD.locked_until
      AND NEW.last_authenticated_at IS OLD.last_authenticated_at
      AND NEW.last_change_id IS OLD.last_change_id
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'password credential revision conflict');
END;

CREATE TRIGGER identity_password_credential_secret_rotation
AFTER UPDATE OF secret_version ON identity_password_credential
WHEN NEW.secret_version = OLD.secret_version + 1
BEGIN
  UPDATE identity_account
  SET security_version = security_version + 1,
      updated_at = NEW.updated_at,
      revision = revision + 1,
      write_nonce = NEW.last_change_id
  WHERE id = NEW.account_id
    AND security_version = (
      SELECT target_security_version - 1
      FROM identity_password_change
      WHERE id = NEW.last_change_id
    );

  SELECT CASE WHEN changes() != 1
    THEN RAISE(ABORT, 'password rotation failed to advance account security version') END;
END;

CREATE TRIGGER identity_password_change_authority_guard
BEFORE INSERT ON identity_password_change
WHEN NOT (
  EXISTS (
    SELECT 1
    FROM identity_password_credential AS credential
    JOIN identity_account AS account ON account.id = credential.account_id
    WHERE credential.id = NEW.credential_id
      AND credential.account_id = NEW.account_id
      AND credential.status = 'active'
      AND credential.secret_version = NEW.from_secret_version
      AND NEW.to_secret_version = credential.secret_version + 1
      AND account.status = 'active'
      AND NEW.target_security_version = account.security_version + 1
  )
  AND (
    (
      NEW.change_kind = 'authenticated_change'
      AND EXISTS (
        SELECT 1
        FROM identity_password_change_confirmation AS confirmation
        JOIN identity_session AS authorizing_session
          ON authorizing_session.id = NEW.authorizing_session_id
         AND authorizing_session.account_id = NEW.account_id
        JOIN identity_account AS account ON account.id = NEW.account_id
        WHERE confirmation.auth_intent_id = NEW.confirmation_auth_intent_id
          AND confirmation.account_id = NEW.account_id
          AND confirmation.initiating_session_id = NEW.authorizing_session_id
          AND confirmation.confirmed_at <= NEW.changed_at
          AND confirmation.confirmed_at >= NEW.changed_at - 900000
          AND authorizing_session.revoked_at IS NULL
          AND authorizing_session.recovery_restricted = 0
          AND authorizing_session.security_version = account.security_version
          AND authorizing_session.created_at <= NEW.changed_at
          AND authorizing_session.idle_expires_at > NEW.changed_at
          AND authorizing_session.absolute_expires_at > NEW.changed_at
      )
    )
    OR
    (
      NEW.change_kind = 'recovery_code'
      AND EXISTS (
        SELECT 1
        FROM identity_session AS recovery_session
        JOIN identity_recovery_code AS recovery_code
          ON recovery_code.id = recovery_session.recovery_code_id
        JOIN identity_recovery_code_set AS code_set
          ON code_set.id = recovery_code.set_id
        JOIN identity_account AS account ON account.id = NEW.account_id
        WHERE recovery_session.id = NEW.authorizing_session_id
          AND recovery_session.account_id = NEW.account_id
          AND recovery_session.auth_method = 'recovery_code'
          AND recovery_session.recovery_restricted = 1
          AND recovery_session.recovery_auth_intent_id = NEW.confirmation_auth_intent_id
          AND recovery_session.recovery_verified_at = recovery_code.consumed_at
          AND recovery_session.recovery_verified_at >= NEW.changed_at - 900000
          AND recovery_session.revoked_at IS NULL
          AND recovery_session.security_version = account.security_version
          AND recovery_session.idle_expires_at > NEW.changed_at
          AND recovery_session.absolute_expires_at > NEW.changed_at
          AND code_set.account_id = NEW.account_id
          AND code_set.status = 'active'
          AND account.status = 'active'
      )
    )
    OR
    (
      NEW.change_kind = 'assisted_recovery'
      AND EXISTS (
        SELECT 1
        FROM identity_session AS recovery_session
        JOIN identity_assisted_recovery_case AS recovery_case
          ON recovery_case.id = NEW.assisted_recovery_case_id
         AND recovery_case.account_id = NEW.account_id
        JOIN identity_assisted_recovery_authorization AS authorization
          ON authorization.case_id = recovery_case.id
         AND authorization.consumed_auth_intent_id = recovery_session.recovery_auth_intent_id
        JOIN identity_account AS account ON account.id = NEW.account_id
        WHERE recovery_session.id = NEW.authorizing_session_id
          AND recovery_session.account_id = NEW.account_id
          AND account.security_version = recovery_session.security_version
          AND recovery_case.status = 'consumed'
          AND recovery_session.auth_method = 'assisted_recovery'
          AND recovery_session.recovery_restricted = 1
          AND recovery_session.phishing_resistant_at IS NULL
          AND recovery_session.revoked_at IS NULL
          AND recovery_session.created_at <= NEW.changed_at
          AND recovery_session.idle_expires_at > NEW.changed_at
          AND recovery_session.absolute_expires_at > NEW.changed_at
          AND authorization.consumed_at = recovery_session.recovery_verified_at
      )
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'password change authorization mismatch');
END;

CREATE TRIGGER identity_password_change_update_guard
BEFORE UPDATE ON identity_password_change
BEGIN
  SELECT RAISE(ABORT, 'password changes are append-only');
END;

CREATE TRIGGER identity_password_change_delete_guard
BEFORE DELETE ON identity_password_change
BEGIN
  SELECT RAISE(ABORT, 'password changes are retained');
END;

CREATE TRIGGER identity_password_change_insert_conflict_guard
BEFORE INSERT ON identity_password_change
WHEN EXISTS (
  SELECT 1 FROM identity_password_change AS existing
  WHERE existing.id = NEW.id
    OR (NEW.confirmation_auth_intent_id IS NOT NULL
      AND existing.confirmation_auth_intent_id = NEW.confirmation_auth_intent_id)
    OR (NEW.assisted_recovery_case_id IS NOT NULL
      AND existing.assisted_recovery_case_id = NEW.assisted_recovery_case_id)
)
BEGIN
  SELECT RAISE(ABORT, 'password change insert conflict');
END;

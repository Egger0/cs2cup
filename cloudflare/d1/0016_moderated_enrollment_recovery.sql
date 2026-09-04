CREATE TABLE identity_assisted_recovery_case (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (length(id) = 43 AND id NOT GLOB '*[^A-Za-z0-9_-]*'),
  account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  receipt_hash TEXT NOT NULL UNIQUE COLLATE BINARY
    CHECK (length(receipt_hash) = 64 AND receipt_hash NOT GLOB '*[^0-9a-f]*'),
  evidence_statement TEXT NOT NULL
    CHECK (
      length(evidence_statement) BETWEEN 10 AND 2000
      AND evidence_statement = trim(evidence_statement)
    ),
  status TEXT NOT NULL COLLATE BINARY DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'consumed', 'expired')),
  requested_at INTEGER NOT NULL
    CHECK (typeof(requested_at) = 'integer' AND requested_at >= 0),
  not_before_at INTEGER NOT NULL
    CHECK (
      typeof(not_before_at) = 'integer'
      AND not_before_at >= requested_at + 86400000
    ),
  expires_at INTEGER NOT NULL
    CHECK (
      typeof(expires_at) = 'integer'
      AND expires_at > not_before_at
      AND expires_at <= requested_at + 2592000000
    ),
  review_id TEXT UNIQUE COLLATE BINARY
    REFERENCES identity_assisted_recovery_review(id) ON DELETE RESTRICT,
  reviewed_at INTEGER
    CHECK (
      reviewed_at IS NULL
      OR (typeof(reviewed_at) = 'integer' AND reviewed_at BETWEEN requested_at AND expires_at)
    ),
  consumed_at INTEGER
    CHECK (
      consumed_at IS NULL
      OR (typeof(consumed_at) = 'integer' AND consumed_at BETWEEN not_before_at AND expires_at - 1)
    ),
  revision INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(revision) = 'integer' AND revision >= 0),
  write_nonce TEXT COLLATE BINARY
    CHECK (
      write_nonce IS NULL
      OR (length(write_nonce) = 43 AND write_nonce NOT GLOB '*[^A-Za-z0-9_-]*')
    ),
  UNIQUE (id, receipt_hash),
  CHECK (
    (status = 'pending' AND review_id IS NULL AND reviewed_at IS NULL AND consumed_at IS NULL)
    OR
    (status IN ('approved', 'rejected')
      AND review_id IS NOT NULL AND reviewed_at IS NOT NULL AND consumed_at IS NULL)
    OR
    (status = 'consumed'
      AND review_id IS NOT NULL AND reviewed_at IS NOT NULL AND consumed_at IS NOT NULL)
    OR
    (status = 'expired' AND consumed_at IS NULL)
  )
);

CREATE INDEX identity_assisted_recovery_case_queue_idx
ON identity_assisted_recovery_case(status, requested_at);

CREATE INDEX identity_assisted_recovery_case_expiry_idx
ON identity_assisted_recovery_case(expires_at)
WHERE status IN ('pending', 'approved');

CREATE UNIQUE INDEX identity_assisted_recovery_case_write_nonce_idx
ON identity_assisted_recovery_case(write_nonce)
WHERE write_nonce IS NOT NULL;

CREATE TABLE identity_assisted_recovery_review (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (length(id) = 43 AND id NOT GLOB '*[^A-Za-z0-9_-]*'),
  case_id TEXT NOT NULL UNIQUE COLLATE BINARY
    REFERENCES identity_assisted_recovery_case(id) ON DELETE RESTRICT,
  reviewer_account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  reviewer_session_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_session(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL COLLATE BINARY
    CHECK (decision IN ('approved', 'rejected')),
  reason TEXT NOT NULL
    CHECK (length(reason) BETWEEN 10 AND 2000 AND reason = trim(reason)),
  decided_at INTEGER NOT NULL
    CHECK (typeof(decided_at) = 'integer' AND decided_at >= 0),
  request_correlation_id TEXT NOT NULL COLLATE BINARY
    CHECK (
      length(request_correlation_id) BETWEEN 16 AND 128
      AND request_correlation_id NOT GLOB '*[^A-Za-z0-9_.:-]*'
    )
);

CREATE INDEX identity_assisted_recovery_review_reviewer_idx
ON identity_assisted_recovery_review(reviewer_account_id, decided_at DESC);

CREATE TABLE identity_assisted_recovery_authorization (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (length(id) = 43 AND id NOT GLOB '*[^A-Za-z0-9_-]*'),
  case_id TEXT NOT NULL UNIQUE COLLATE BINARY,
  receipt_hash TEXT NOT NULL COLLATE BINARY
    CHECK (length(receipt_hash) = 64 AND receipt_hash NOT GLOB '*[^0-9a-f]*'),
  secret_hash TEXT NOT NULL UNIQUE COLLATE BINARY
    CHECK (length(secret_hash) = 64 AND secret_hash NOT GLOB '*[^0-9a-f]*'),
  issued_at INTEGER NOT NULL
    CHECK (typeof(issued_at) = 'integer' AND issued_at >= 0),
  not_before_at INTEGER NOT NULL
    CHECK (typeof(not_before_at) = 'integer' AND not_before_at >= issued_at),
  expires_at INTEGER NOT NULL
    CHECK (
      typeof(expires_at) = 'integer'
      AND expires_at > not_before_at
      AND expires_at <= issued_at + 604800000
    ),
  consumed_auth_intent_id TEXT UNIQUE COLLATE BINARY
    REFERENCES identity_auth_intent(id) ON DELETE RESTRICT,
  consumed_at INTEGER
    CHECK (
      consumed_at IS NULL
      OR (typeof(consumed_at) = 'integer' AND consumed_at BETWEEN not_before_at AND expires_at - 1)
    ),
  consume_nonce TEXT UNIQUE COLLATE BINARY
    CHECK (
      consume_nonce IS NULL
      OR (length(consume_nonce) = 43 AND consume_nonce NOT GLOB '*[^A-Za-z0-9_-]*')
    ),
  FOREIGN KEY (case_id, receipt_hash)
    REFERENCES identity_assisted_recovery_case(id, receipt_hash) ON DELETE RESTRICT,
  CHECK (
    (consumed_at IS NULL AND consumed_auth_intent_id IS NULL AND consume_nonce IS NULL)
    OR
    (consumed_at IS NOT NULL AND consumed_auth_intent_id IS NOT NULL AND consume_nonce IS NOT NULL)
  )
);

CREATE INDEX identity_assisted_recovery_authorization_expiry_idx
ON identity_assisted_recovery_authorization(expires_at)
WHERE consumed_at IS NULL;

CREATE TRIGGER identity_assisted_recovery_case_fresh_insert_guard
BEFORE INSERT ON identity_assisted_recovery_case
WHEN NEW.status != 'pending'
  OR NEW.review_id IS NOT NULL
  OR NEW.reviewed_at IS NOT NULL
  OR NEW.consumed_at IS NOT NULL
  OR NEW.revision != 0
  OR NEW.write_nonce IS NOT NULL
  OR NOT EXISTS (
    SELECT 1
    FROM identity_account AS account
    JOIN identity_password_credential AS credential ON credential.account_id = account.id
    WHERE account.id = NEW.account_id
      AND account.status = 'active'
      AND credential.status = 'active'
  )
BEGIN
  SELECT RAISE(ABORT, 'assisted recovery case requires an active password account');
END;

CREATE TRIGGER identity_assisted_recovery_review_authority_guard
BEFORE INSERT ON identity_assisted_recovery_review
WHEN NOT EXISTS (
  SELECT 1
  FROM identity_assisted_recovery_case AS recovery_case
  JOIN identity_account AS reviewer ON reviewer.id = NEW.reviewer_account_id
  JOIN identity_session AS reviewer_session
    ON reviewer_session.id = NEW.reviewer_session_id
   AND reviewer_session.account_id = reviewer.id
  JOIN identity_role_assignment AS assignment ON assignment.account_id = reviewer.id
  WHERE recovery_case.id = NEW.case_id
    AND recovery_case.status = 'pending'
    AND recovery_case.account_id != reviewer.id
    AND recovery_case.requested_at <= NEW.decided_at
    AND recovery_case.expires_at > NEW.decided_at
    AND reviewer.status = 'active'
    AND reviewer.security_version = reviewer_session.security_version
    AND reviewer_session.revoked_at IS NULL
    AND reviewer_session.recovery_restricted = 0
    AND reviewer_session.authenticated_at >= NEW.decided_at - 900000
    AND reviewer_session.authenticated_at <= NEW.decided_at
    AND reviewer_session.created_at <= NEW.decided_at
    AND reviewer_session.idle_expires_at > NEW.decided_at
    AND reviewer_session.absolute_expires_at > NEW.decided_at
    AND assignment.scope_type = 'platform'
    AND assignment.role IN ('identity_reviewer', 'platform_owner')
    AND assignment.revoked_at IS NULL
    AND assignment.granted_at <= NEW.decided_at
    AND (assignment.expires_at IS NULL OR assignment.expires_at > NEW.decided_at)
)
BEGIN
  SELECT RAISE(ABORT, 'assisted recovery requires a different current identity reviewer');
END;

CREATE TRIGGER identity_assisted_recovery_review_update_guard
BEFORE UPDATE ON identity_assisted_recovery_review
BEGIN
  SELECT RAISE(ABORT, 'assisted recovery reviews are append-only');
END;

CREATE TRIGGER identity_assisted_recovery_review_delete_guard
BEFORE DELETE ON identity_assisted_recovery_review
BEGIN
  SELECT RAISE(ABORT, 'assisted recovery reviews are retained');
END;

CREATE TRIGGER identity_assisted_recovery_case_update_guard
BEFORE UPDATE ON identity_assisted_recovery_case
WHEN NEW.id IS NOT OLD.id
  OR NEW.account_id IS NOT OLD.account_id
  OR NEW.receipt_hash IS NOT OLD.receipt_hash
  OR NEW.evidence_statement IS NOT OLD.evidence_statement
  OR NEW.requested_at IS NOT OLD.requested_at
  OR NEW.not_before_at IS NOT OLD.not_before_at
  OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
  OR OLD.status IN ('rejected', 'consumed', 'expired')
  OR NOT (
    (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected', 'expired'))
    OR (OLD.status = 'approved' AND NEW.status IN ('consumed', 'expired'))
  )
  OR (OLD.review_id IS NOT NULL AND NEW.review_id IS NOT OLD.review_id)
  OR (OLD.reviewed_at IS NOT NULL AND NEW.reviewed_at IS NOT OLD.reviewed_at)
BEGIN
  SELECT RAISE(ABORT, 'assisted recovery case state conflict');
END;

CREATE TRIGGER identity_assisted_recovery_case_review_guard
BEFORE UPDATE ON identity_assisted_recovery_case
WHEN OLD.status = 'pending'
  AND NEW.status IN ('approved', 'rejected')
  AND NOT EXISTS (
    SELECT 1 FROM identity_assisted_recovery_review AS review
    WHERE review.id = NEW.review_id
      AND review.case_id = OLD.id
      AND review.decision = NEW.status
      AND review.decided_at = NEW.reviewed_at
  )
BEGIN
  SELECT RAISE(ABORT, 'assisted recovery decision proof mismatch');
END;

CREATE TRIGGER identity_assisted_recovery_case_consumption_guard
BEFORE UPDATE ON identity_assisted_recovery_case
WHEN OLD.status = 'approved' AND NEW.status = 'consumed'
  AND NOT EXISTS (
    SELECT 1 FROM identity_assisted_recovery_authorization AS authorization
    WHERE authorization.case_id = OLD.id
      AND authorization.consumed_at = NEW.consumed_at
      AND authorization.consumed_at >= OLD.not_before_at
      AND authorization.consumed_at < OLD.expires_at
  )
BEGIN
  SELECT RAISE(ABORT, 'assisted recovery consumption proof mismatch');
END;

CREATE TRIGGER identity_assisted_recovery_case_expiry_guard
BEFORE UPDATE ON identity_assisted_recovery_case
WHEN NEW.status = 'expired'
  AND NOT (
    NEW.expires_at <= unixepoch() * 1000
    OR (OLD.status = 'approved' AND EXISTS (
      SELECT 1 FROM identity_assisted_recovery_authorization AS authorization
      WHERE authorization.case_id = OLD.id
        AND authorization.consumed_at IS NULL
        AND authorization.expires_at <= unixepoch() * 1000
    ))
  )
BEGIN
  SELECT RAISE(ABORT, 'assisted recovery case has not expired');
END;

CREATE TRIGGER identity_assisted_recovery_case_delete_guard
BEFORE DELETE ON identity_assisted_recovery_case
BEGIN
  SELECT RAISE(ABORT, 'assisted recovery cases are retained');
END;

CREATE TRIGGER identity_assisted_recovery_authorization_fresh_insert_guard
BEFORE INSERT ON identity_assisted_recovery_authorization
WHEN NEW.consumed_auth_intent_id IS NOT NULL
  OR NEW.consumed_at IS NOT NULL
  OR NEW.consume_nonce IS NOT NULL
  OR NOT EXISTS (
    SELECT 1
    FROM identity_assisted_recovery_case AS recovery_case
    JOIN identity_assisted_recovery_review AS review ON review.id = recovery_case.review_id
    WHERE recovery_case.id = NEW.case_id
      AND recovery_case.receipt_hash = NEW.receipt_hash
      AND recovery_case.status = 'approved'
      AND review.decision = 'approved'
      AND review.decided_at = recovery_case.reviewed_at
      AND NEW.issued_at >= review.decided_at
      AND NEW.issued_at < recovery_case.expires_at
      AND NEW.not_before_at >= recovery_case.not_before_at
      AND NEW.expires_at <= recovery_case.expires_at
  )
BEGIN
  SELECT RAISE(ABORT, 'recovery authorization requires an approved delayed case');
END;

CREATE TRIGGER identity_assisted_recovery_authorization_update_guard
BEFORE UPDATE ON identity_assisted_recovery_authorization
WHEN NEW.id IS NOT OLD.id
  OR NEW.case_id IS NOT OLD.case_id
  OR NEW.receipt_hash IS NOT OLD.receipt_hash
  OR NEW.secret_hash IS NOT OLD.secret_hash
  OR NEW.issued_at IS NOT OLD.issued_at
  OR NEW.not_before_at IS NOT OLD.not_before_at
  OR NEW.expires_at IS NOT OLD.expires_at
  OR OLD.consumed_at IS NOT NULL
  OR NEW.consumed_auth_intent_id IS NULL
  OR NEW.consumed_at IS NULL
  OR NEW.consume_nonce IS NULL
  OR NOT EXISTS (
    SELECT 1
    FROM identity_assisted_recovery_case AS recovery_case
    JOIN identity_auth_intent AS recovery_intent
      ON recovery_intent.id = NEW.consumed_auth_intent_id
    WHERE recovery_case.id = OLD.case_id
      AND recovery_case.status = 'approved'
      AND recovery_intent.purpose = 'recovery'
      AND recovery_intent.expected_account_id = recovery_case.account_id
      AND recovery_intent.consumed_at IS NULL
      AND recovery_intent.attempt_count < recovery_intent.max_attempts
      AND recovery_intent.created_at <= NEW.consumed_at
      AND recovery_intent.expires_at > NEW.consumed_at
      AND NEW.consumed_at >= OLD.not_before_at
      AND NEW.consumed_at < OLD.expires_at
  )
BEGIN
  SELECT RAISE(ABORT, 'recovery authorization consumption conflict');
END;

CREATE TRIGGER identity_assisted_recovery_authorization_delete_guard
BEFORE DELETE ON identity_assisted_recovery_authorization
BEGIN
  SELECT RAISE(ABORT, 'recovery authorizations are retained');
END;

DROP TRIGGER identity_recovery_intent_completion_guard;

CREATE TRIGGER identity_recovery_intent_completion_guard
BEFORE UPDATE ON identity_auth_intent
WHEN OLD.purpose = 'recovery'
  AND OLD.consumed_at IS NULL
  AND NEW.consumed_at IS NOT NULL
  AND NOT (
    (
      NEW.completion_result_type = 'recovery_code'
      AND EXISTS (
        SELECT 1
        FROM identity_recovery_code AS recovery_code
        JOIN identity_recovery_code_set AS code_set ON code_set.id = recovery_code.set_id
        WHERE recovery_code.id = NEW.completion_result_ref
          AND recovery_code.consumed_auth_intent_id = OLD.id
          AND recovery_code.consumed_at = NEW.consumed_at
          AND code_set.account_id = OLD.expected_account_id
          AND code_set.status = 'active'
      )
    )
    OR
    (
      NEW.completion_result_type = 'verified_identity'
      AND NEW.completion_result_ref = OLD.verified_identity_id
      AND EXISTS (
        SELECT 1
        FROM identity_verified_identity AS recovery_identity
        WHERE recovery_identity.id = OLD.verified_identity_id
          AND recovery_identity.account_id = OLD.expected_account_id
          AND recovery_identity.status = 'active'
          AND recovery_identity.recovery_capable = 1
      )
    )
    OR
    (
      NEW.completion_result_type = 'assisted_recovery'
      AND EXISTS (
        SELECT 1
        FROM identity_assisted_recovery_authorization AS authorization
        JOIN identity_assisted_recovery_case AS recovery_case
          ON recovery_case.id = authorization.case_id
        WHERE authorization.id = NEW.completion_result_ref
          AND authorization.consumed_auth_intent_id = OLD.id
          AND authorization.consumed_at = NEW.consumed_at
          AND recovery_case.account_id = OLD.expected_account_id
          AND recovery_case.status = 'approved'
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'recovery intent completion proof mismatch');
END;

CREATE TABLE identity_passkey_enrollment_authorization (
  auth_intent_id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    REFERENCES identity_auth_intent(id) ON DELETE RESTRICT,
  account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  initiating_session_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_session(id) ON DELETE RESTRICT,
  authorized_at INTEGER NOT NULL
    CHECK (typeof(authorized_at) = 'integer' AND authorized_at >= 0)
);

CREATE INDEX identity_passkey_enrollment_authorization_account_idx
ON identity_passkey_enrollment_authorization(account_id, authorized_at DESC);

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
    AND initiating_session.idle_expires_at > NEW.authorized_at
    AND initiating_session.absolute_expires_at > NEW.authorized_at
    AND account.status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'passkey enrollment requires a current account session');
END;

CREATE TRIGGER identity_passkey_enrollment_authorization_update_guard
BEFORE UPDATE ON identity_passkey_enrollment_authorization
BEGIN
  SELECT RAISE(ABORT, 'passkey enrollment authorizations are immutable');
END;

CREATE TRIGGER identity_passkey_enrollment_authorization_delete_guard
BEFORE DELETE ON identity_passkey_enrollment_authorization
BEGIN
  SELECT RAISE(ABORT, 'passkey enrollment authorizations are retained');
END;

CREATE TRIGGER identity_passkey_registration_session_guard
BEFORE INSERT ON identity_passkey_credential
WHEN NEW.registration_kind = 'ceremony'
  AND NOT EXISTS (
    SELECT 1
    FROM identity_passkey_enrollment_authorization AS authorization
    WHERE authorization.auth_intent_id = NEW.registration_auth_intent_id
      AND authorization.account_id = NEW.account_id
      AND authorization.authorized_at <= NEW.created_at
  )
BEGIN
  SELECT RAISE(ABORT, 'passkey enrollment requires a signed-in authorization');
END;

CREATE TRIGGER identity_session_security_version_insert_guard
BEFORE INSERT ON identity_session
WHEN NOT EXISTS (
  SELECT 1 FROM identity_account
  WHERE id = NEW.account_id
    AND status = 'active'
    AND security_version = NEW.security_version
)
BEGIN
  SELECT RAISE(ABORT, 'identity session account state or security version mismatch');
END;

CREATE TRIGGER identity_session_passkey_insert_guard
BEFORE INSERT ON identity_session
WHEN NEW.auth_method = 'passkey'
  AND NOT EXISTS (
    SELECT 1
    FROM identity_passkey_credential AS credential
    JOIN identity_auth_intent AS passkey_intent
      ON passkey_intent.id = NEW.passkey_auth_intent_id
    WHERE credential.credential_id = NEW.authenticator_credential_id
      AND credential.account_id = NEW.account_id
      AND credential.status = 'active'
      AND passkey_intent.purpose IN ('passkey_sign_in', 'passkey_step_up')
      AND (passkey_intent.expected_account_id IS NULL
        OR passkey_intent.expected_account_id = NEW.account_id)
      AND passkey_intent.consumed_at = NEW.authenticated_at
      AND passkey_intent.completion_result_type = 'passkey_credential'
      AND passkey_intent.completion_result_ref = credential.credential_id
      AND NEW.phishing_resistant_at = passkey_intent.consumed_at
  )
BEGIN
  SELECT RAISE(ABORT, 'identity session requires a consumed passkey ceremony');
END;

CREATE TRIGGER identity_session_password_insert_guard
BEFORE INSERT ON identity_session
WHEN NEW.auth_method = 'password'
  AND NOT EXISTS (
    SELECT 1
    FROM identity_password_credential AS credential
    WHERE credential.id = NEW.password_credential_id
      AND credential.account_id = NEW.account_id
      AND credential.status = 'active'
      AND credential.last_authenticated_at = NEW.authenticated_at
      AND credential.write_nonce = NEW.password_verification_nonce
      AND (credential.locked_until IS NULL OR credential.locked_until <= NEW.authenticated_at)
  )
BEGIN
  SELECT RAISE(ABORT, 'identity session requires a verified password credential');
END;

CREATE TRIGGER identity_session_recovery_context_insert_guard
BEFORE INSERT ON identity_session
WHEN NEW.recovery_restricted = 1
  AND NEW.auth_method NOT IN ('assisted_recovery', 'recovery_code')
  AND NOT EXISTS (
    SELECT 1
    FROM identity_auth_intent AS recovery_intent
    WHERE recovery_intent.id = NEW.recovery_auth_intent_id
      AND recovery_intent.purpose = 'recovery'
      AND recovery_intent.expected_account_id = NEW.account_id
      AND recovery_intent.consumed_at = NEW.recovery_verified_at
      AND (
        EXISTS (
          SELECT 1
          FROM identity_verified_identity AS recovery_identity
          WHERE recovery_identity.id = recovery_intent.verified_identity_id
            AND recovery_identity.account_id = NEW.account_id
            AND recovery_identity.adapter_kind = NEW.auth_method
            AND recovery_identity.status = 'active'
            AND recovery_identity.recovery_capable = 1
            AND recovery_intent.completion_result_type = 'verified_identity'
            AND recovery_intent.completion_result_ref = recovery_identity.id
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'identity session requires a consumed recovery intent');
END;

CREATE TRIGGER identity_session_recovery_code_insert_guard
BEFORE INSERT ON identity_session
WHEN NEW.auth_method = 'recovery_code'
  AND NOT EXISTS (
    SELECT 1
    FROM identity_recovery_code AS recovery_code
    JOIN identity_recovery_code_set AS code_set ON code_set.id = recovery_code.set_id
    JOIN identity_auth_intent AS recovery_intent
      ON recovery_intent.id = recovery_code.consumed_auth_intent_id
    WHERE recovery_code.id = NEW.recovery_code_id
      AND code_set.account_id = NEW.account_id
      AND code_set.status = 'active'
      AND recovery_code.consumed_at = NEW.recovery_verified_at
      AND recovery_intent.id = NEW.recovery_auth_intent_id
      AND recovery_intent.purpose = 'recovery'
      AND recovery_intent.expected_account_id = NEW.account_id
      AND recovery_intent.consumed_at IS NOT NULL
      AND recovery_intent.completion_result_type = 'recovery_code'
      AND recovery_intent.completion_result_ref = recovery_code.id
      AND NEW.created_at >= recovery_code.consumed_at
  )
BEGIN
  SELECT RAISE(ABORT, 'identity session requires a consumed recovery code');
END;

CREATE TRIGGER identity_session_assisted_recovery_insert_guard
BEFORE INSERT ON identity_session
WHEN NEW.auth_method = 'assisted_recovery'
  AND NOT EXISTS (
    SELECT 1
    FROM identity_auth_intent AS recovery_intent
    JOIN identity_assisted_recovery_authorization AS authorization
      ON authorization.id = recovery_intent.completion_result_ref
    JOIN identity_assisted_recovery_case AS recovery_case
      ON recovery_case.id = authorization.case_id
    WHERE recovery_intent.id = NEW.recovery_auth_intent_id
      AND recovery_intent.purpose = 'recovery'
      AND recovery_intent.expected_account_id = NEW.account_id
      AND recovery_intent.consumed_at = NEW.recovery_verified_at
      AND recovery_intent.completion_result_type = 'assisted_recovery'
      AND authorization.consumed_auth_intent_id = recovery_intent.id
      AND authorization.consumed_at = NEW.recovery_verified_at
      AND recovery_case.account_id = NEW.account_id
      AND recovery_case.status = 'consumed'
      AND recovery_case.consumed_at = NEW.recovery_verified_at
      AND NEW.created_at = NEW.recovery_verified_at
      AND NEW.recovery_restricted = 1
      AND NEW.phishing_resistant_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'assisted recovery is not enabled without a consumed approved case');
END;

CREATE TRIGGER identity_session_update_guard
BEFORE UPDATE ON identity_session
WHEN NEW.id IS NOT OLD.id
  OR NEW.token_hash IS NOT OLD.token_hash
  OR NEW.account_id IS NOT OLD.account_id
  OR NEW.security_version IS NOT OLD.security_version
  OR NEW.auth_method IS NOT OLD.auth_method
  OR NEW.authenticator_credential_id IS NOT OLD.authenticator_credential_id
  OR NEW.password_credential_id IS NOT OLD.password_credential_id
  OR NEW.password_verification_nonce IS NOT OLD.password_verification_nonce
  OR NEW.passkey_auth_intent_id IS NOT OLD.passkey_auth_intent_id
  OR NEW.recovery_code_id IS NOT OLD.recovery_code_id
  OR NEW.recovery_auth_intent_id IS NOT OLD.recovery_auth_intent_id
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.absolute_expires_at IS NOT OLD.absolute_expires_at
  OR NEW.authenticated_at IS NOT OLD.authenticated_at
  OR NEW.phishing_resistant_at IS NOT OLD.phishing_resistant_at
  OR NEW.recovery_verified_at IS NOT OLD.recovery_verified_at
  OR NEW.recovery_restricted IS NOT OLD.recovery_restricted
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
  OR NEW.last_seen_at < OLD.last_seen_at
  OR OLD.revoked_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'identity session revision conflict');
END;

CREATE TRIGGER identity_session_insert_conflict_guard
BEFORE INSERT ON identity_session
WHEN EXISTS (
  SELECT 1 FROM identity_session AS existing
  WHERE existing.id = NEW.id
    OR existing.token_hash = NEW.token_hash
    OR (NEW.passkey_auth_intent_id IS NOT NULL
      AND existing.passkey_auth_intent_id = NEW.passkey_auth_intent_id)
    OR (NEW.recovery_code_id IS NOT NULL AND existing.recovery_code_id = NEW.recovery_code_id)
    OR (NEW.recovery_auth_intent_id IS NOT NULL
      AND existing.recovery_auth_intent_id = NEW.recovery_auth_intent_id)
    OR (NEW.password_verification_nonce IS NOT NULL
      AND existing.password_verification_nonce = NEW.password_verification_nonce)
    OR (NEW.write_nonce IS NOT NULL AND existing.write_nonce = NEW.write_nonce)
)
BEGIN
  SELECT RAISE(ABORT, 'identity session insert conflict');
END;

CREATE TABLE identity_legacy_admin_bootstrap (
  legacy_admin_id INTEGER PRIMARY KEY NOT NULL
    REFERENCES admin_account(id) ON DELETE RESTRICT
    CHECK (legacy_admin_id = 1),
  secret_hash TEXT NOT NULL UNIQUE COLLATE BINARY
    CHECK (length(secret_hash) = 64 AND secret_hash NOT GLOB '*[^0-9a-f]*'),
  legacy_session_token_hash TEXT NOT NULL COLLATE BINARY
    CHECK (
      length(legacy_session_token_hash) = 64
      AND legacy_session_token_hash NOT GLOB '*[^0-9a-f]*'
    ),
  expected_account_id TEXT NOT NULL UNIQUE COLLATE BINARY
    CHECK (length(expected_account_id) = 43 AND expected_account_id NOT GLOB '*[^A-Za-z0-9_-]*'),
  status TEXT NOT NULL COLLATE BINARY DEFAULT 'open'
    CHECK (status IN ('open', 'consumed', 'completed', 'closed')),
  issued_at INTEGER NOT NULL
    CHECK (typeof(issued_at) = 'integer' AND issued_at >= 0),
  expires_at INTEGER NOT NULL
    CHECK (
      typeof(expires_at) = 'integer'
      AND expires_at > issued_at
      AND expires_at <= issued_at + 3600000
    ),
  consumed_at INTEGER
    CHECK (
      consumed_at IS NULL
      OR (typeof(consumed_at) = 'integer' AND consumed_at BETWEEN issued_at AND expires_at - 1)
    ),
  consume_nonce TEXT UNIQUE COLLATE BINARY
    CHECK (
      consume_nonce IS NULL
      OR (length(consume_nonce) = 43 AND consume_nonce NOT GLOB '*[^A-Za-z0-9_-]*')
    ),
  password_credential_id TEXT UNIQUE COLLATE BINARY
    REFERENCES identity_password_credential(id) ON DELETE RESTRICT,
  owner_role_assignment_id TEXT UNIQUE COLLATE BINARY
    REFERENCES identity_role_assignment(id) ON DELETE RESTRICT,
  completed_at INTEGER
    CHECK (
      completed_at IS NULL
      OR (typeof(completed_at) = 'integer' AND consumed_at IS NOT NULL AND completed_at >= consumed_at)
    ),
  closed_at INTEGER
    CHECK (closed_at IS NULL OR (typeof(closed_at) = 'integer' AND closed_at >= issued_at)),
  close_reason TEXT
    CHECK (
      close_reason IS NULL
      OR (length(close_reason) BETWEEN 3 AND 500 AND close_reason = trim(close_reason))
    ),
  revision INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(revision) = 'integer' AND revision >= 0),
  write_nonce TEXT COLLATE BINARY
    CHECK (
      write_nonce IS NULL
      OR (length(write_nonce) = 43 AND write_nonce NOT GLOB '*[^A-Za-z0-9_-]*')
    ),
  CHECK (
    (status = 'open'
      AND consumed_at IS NULL AND consume_nonce IS NULL AND password_credential_id IS NULL
      AND owner_role_assignment_id IS NULL AND completed_at IS NULL
      AND closed_at IS NULL AND close_reason IS NULL)
    OR
    (status = 'consumed'
      AND consumed_at IS NOT NULL AND consume_nonce IS NOT NULL AND password_credential_id IS NOT NULL
      AND owner_role_assignment_id IS NULL AND completed_at IS NULL
      AND closed_at IS NULL AND close_reason IS NULL)
    OR
    (status = 'completed'
      AND consumed_at IS NOT NULL AND consume_nonce IS NOT NULL AND password_credential_id IS NOT NULL
      AND owner_role_assignment_id IS NOT NULL AND completed_at IS NOT NULL
      AND closed_at IS NULL AND close_reason IS NULL)
    OR
    (status = 'closed' AND completed_at IS NULL AND closed_at IS NOT NULL AND close_reason IS NOT NULL)
  )
);

CREATE UNIQUE INDEX identity_legacy_admin_bootstrap_write_nonce_idx
ON identity_legacy_admin_bootstrap(write_nonce)
WHERE write_nonce IS NOT NULL;

CREATE UNIQUE INDEX identity_role_single_platform_owner_idx
ON identity_role_assignment((1))
WHERE role = 'platform_owner' AND scope_type = 'platform' AND revoked_at IS NULL;

CREATE TRIGGER identity_legacy_admin_bootstrap_fresh_insert_guard
BEFORE INSERT ON identity_legacy_admin_bootstrap
WHEN NEW.status != 'open'
  OR NEW.consumed_at IS NOT NULL
  OR NEW.consume_nonce IS NOT NULL
  OR NEW.password_credential_id IS NOT NULL
  OR NEW.owner_role_assignment_id IS NOT NULL
  OR NEW.completed_at IS NOT NULL
  OR NEW.closed_at IS NOT NULL
  OR NEW.close_reason IS NOT NULL
  OR NEW.revision != 0
  OR NEW.write_nonce IS NOT NULL
  OR EXISTS (
    SELECT 1 FROM identity_role_assignment
    WHERE role = 'platform_owner' AND scope_type = 'platform' AND revoked_at IS NULL
  )
  OR NOT EXISTS (
    SELECT 1
    FROM admin_account AS legacy_admin
    JOIN admin_session AS legacy_session ON legacy_session.admin_id = legacy_admin.id
    WHERE legacy_admin.id = NEW.legacy_admin_id
      AND legacy_session.token_hash = NEW.legacy_session_token_hash
      AND legacy_session.expires_at > NEW.issued_at
      AND NEW.expires_at <= legacy_session.expires_at
  )
  OR EXISTS (SELECT 1 FROM identity_account WHERE id = NEW.expected_account_id)
BEGIN
  SELECT RAISE(ABORT, 'legacy admin bootstrap requires the current singleton admin');
END;

CREATE TRIGGER identity_legacy_admin_bootstrap_update_guard
BEFORE UPDATE ON identity_legacy_admin_bootstrap
WHEN NEW.legacy_admin_id IS NOT OLD.legacy_admin_id
  OR NEW.secret_hash IS NOT OLD.secret_hash
  OR NEW.legacy_session_token_hash IS NOT OLD.legacy_session_token_hash
  OR NEW.expected_account_id IS NOT OLD.expected_account_id
  OR NEW.issued_at IS NOT OLD.issued_at
  OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
  OR OLD.status IN ('completed', 'closed')
  OR NOT (
    (OLD.status = 'open' AND NEW.status IN ('consumed', 'closed'))
    OR (OLD.status = 'consumed' AND NEW.status IN ('completed', 'closed'))
  )
BEGIN
  SELECT RAISE(ABORT, 'legacy admin bootstrap state conflict');
END;

CREATE TRIGGER identity_legacy_admin_bootstrap_consumption_guard
BEFORE UPDATE ON identity_legacy_admin_bootstrap
WHEN OLD.status = 'open' AND NEW.status = 'consumed'
  AND NOT EXISTS (
    SELECT 1
    FROM identity_password_credential AS credential
    JOIN identity_account AS account ON account.id = credential.account_id
    WHERE credential.id = NEW.password_credential_id
      AND credential.registration_kind = 'legacy_admin_bootstrap'
      AND credential.legacy_admin_bootstrap_id = OLD.legacy_admin_id
      AND credential.account_id = OLD.expected_account_id
      AND credential.status = 'active'
      AND account.status = 'active'
      AND account.verification_state = 'legacy_unverified'
      AND NEW.consumed_at >= OLD.issued_at
      AND NEW.consumed_at < OLD.expires_at
      AND credential.created_at <= NEW.consumed_at
  )
BEGIN
  SELECT RAISE(ABORT, 'legacy admin bootstrap password proof mismatch');
END;

CREATE TRIGGER identity_legacy_admin_bootstrap_completion_guard
BEFORE UPDATE ON identity_legacy_admin_bootstrap
WHEN OLD.status = 'consumed' AND NEW.status = 'completed'
  AND NOT EXISTS (
    SELECT 1
    FROM identity_role_assignment AS owner_role
    JOIN identity_account AS account ON account.id = owner_role.account_id
    WHERE owner_role.id = NEW.owner_role_assignment_id
      AND owner_role.account_id = OLD.expected_account_id
      AND owner_role.role = 'platform_owner'
      AND owner_role.scope_type = 'platform'
      AND owner_role.revoked_at IS NULL
      AND account.status = 'active'
      AND NEW.completed_at >= OLD.consumed_at
  )
BEGIN
  SELECT RAISE(ABORT, 'legacy admin bootstrap owner proof mismatch');
END;

CREATE TRIGGER identity_legacy_admin_bootstrap_close_guard
BEFORE UPDATE ON identity_legacy_admin_bootstrap
WHEN NEW.status = 'closed'
  AND (NEW.closed_at IS NULL OR NEW.close_reason IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'closing legacy admin bootstrap requires an audit reason');
END;

CREATE TRIGGER identity_legacy_admin_bootstrap_delete_guard
BEFORE DELETE ON identity_legacy_admin_bootstrap
BEGIN
  SELECT RAISE(ABORT, 'legacy admin bootstrap evidence is retained');
END;

CREATE TRIGGER identity_account_legacy_admin_creation_guard
BEFORE INSERT ON identity_account
WHEN EXISTS (
  SELECT 1 FROM identity_legacy_admin_bootstrap WHERE expected_account_id = NEW.id
)
  AND NOT EXISTS (
    SELECT 1 FROM identity_legacy_admin_bootstrap AS bootstrap
    WHERE bootstrap.expected_account_id = NEW.id
      AND bootstrap.status = 'open'
      AND bootstrap.issued_at <= NEW.created_at
      AND bootstrap.expires_at > NEW.created_at
      AND NEW.status = 'active'
      AND NEW.verification_state = 'legacy_unverified'
  )
BEGIN
  SELECT RAISE(ABORT, 'legacy owner account requires bootstrap provenance');
END;

CREATE TRIGGER identity_initial_platform_owner_provenance_guard
BEFORE INSERT ON identity_role_assignment
WHEN NEW.role = 'platform_owner'
  AND NEW.scope_type = 'platform'
  AND EXISTS (SELECT 1 FROM admin_account WHERE id = 1)
  AND NOT EXISTS (
    SELECT 1 FROM identity_legacy_admin_bootstrap WHERE status = 'completed'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM identity_legacy_admin_bootstrap AS bootstrap
    JOIN identity_account AS account ON account.id = bootstrap.expected_account_id
    WHERE bootstrap.status = 'consumed'
      AND bootstrap.expected_account_id = NEW.account_id
      AND account.status = 'active'
      AND NEW.granted_by_account_id IS NULL
      AND NEW.granted_at >= bootstrap.consumed_at
  )
BEGIN
  SELECT RAISE(ABORT, 'initial platform owner requires legacy admin bootstrap');
END;

-- Reject INSERT OR REPLACE before SQLite can silently delete append-only or one-time state.
CREATE TRIGGER identity_self_registration_insert_conflict_guard
BEFORE INSERT ON identity_self_registration
WHEN EXISTS (
  SELECT 1 FROM identity_self_registration AS existing
  WHERE existing.id = NEW.id
    OR existing.request_proof_hash = NEW.request_proof_hash
    OR existing.expected_account_id = NEW.expected_account_id
    OR existing.requested_username = NEW.requested_username
    OR (NEW.consume_nonce IS NOT NULL AND existing.consume_nonce = NEW.consume_nonce)
    OR (NEW.password_credential_id IS NOT NULL
      AND existing.password_credential_id = NEW.password_credential_id)
)
BEGIN
  SELECT RAISE(ABORT, 'self registration insert conflict');
END;

CREATE TRIGGER identity_membership_application_insert_conflict_guard
BEFORE INSERT ON identity_membership_application
WHEN EXISTS (
  SELECT 1 FROM identity_membership_application AS existing
  WHERE existing.id = NEW.id
    OR (existing.account_id = NEW.account_id
      AND existing.status IN ('draft', 'pending', 'in_review', 'changes_requested')
      AND NEW.status IN ('draft', 'pending', 'in_review', 'changes_requested'))
    OR (NEW.write_nonce IS NOT NULL AND existing.write_nonce = NEW.write_nonce)
)
BEGIN
  SELECT RAISE(ABORT, 'membership application insert conflict');
END;

CREATE TRIGGER identity_membership_review_insert_conflict_guard
BEFORE INSERT ON identity_membership_review
WHEN EXISTS (
  SELECT 1 FROM identity_membership_review AS existing
  WHERE existing.id = NEW.id
    OR (existing.application_id = NEW.application_id
      AND existing.submission_version = NEW.submission_version)
)
BEGIN
  SELECT RAISE(ABORT, 'membership review insert conflict');
END;

CREATE TRIGGER identity_membership_insert_conflict_guard
BEFORE INSERT ON identity_membership
WHEN EXISTS (
  SELECT 1 FROM identity_membership AS existing
  WHERE existing.id = NEW.id
    OR existing.account_id = NEW.account_id
    OR existing.application_id = NEW.application_id
    OR existing.approved_review_id = NEW.approved_review_id
    OR (NEW.write_nonce IS NOT NULL AND existing.write_nonce = NEW.write_nonce)
)
BEGIN
  SELECT RAISE(ABORT, 'membership insert conflict');
END;

CREATE TRIGGER identity_password_credential_insert_conflict_guard
BEFORE INSERT ON identity_password_credential
WHEN EXISTS (
  SELECT 1 FROM identity_password_credential AS existing
  WHERE existing.id = NEW.id
    OR existing.account_id = NEW.account_id
    OR existing.username = NEW.username
    OR (NEW.self_registration_id IS NOT NULL
      AND existing.self_registration_id = NEW.self_registration_id)
    OR (NEW.legacy_admin_bootstrap_id IS NOT NULL
      AND existing.legacy_admin_bootstrap_id = NEW.legacy_admin_bootstrap_id)
    OR (NEW.last_change_id IS NOT NULL AND existing.last_change_id = NEW.last_change_id)
    OR (NEW.write_nonce IS NOT NULL AND existing.write_nonce = NEW.write_nonce)
)
BEGIN
  SELECT RAISE(ABORT, 'password credential insert conflict');
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

CREATE TRIGGER identity_password_change_confirmation_insert_conflict_guard
BEFORE INSERT ON identity_password_change_confirmation
WHEN EXISTS (
  SELECT 1 FROM identity_password_change_confirmation AS existing
  WHERE existing.auth_intent_id = NEW.auth_intent_id
)
BEGIN
  SELECT RAISE(ABORT, 'password confirmation insert conflict');
END;

CREATE TRIGGER identity_assisted_recovery_case_insert_conflict_guard
BEFORE INSERT ON identity_assisted_recovery_case
WHEN EXISTS (
  SELECT 1 FROM identity_assisted_recovery_case AS existing
  WHERE existing.id = NEW.id
    OR existing.receipt_hash = NEW.receipt_hash
    OR (NEW.review_id IS NOT NULL AND existing.review_id = NEW.review_id)
    OR (NEW.write_nonce IS NOT NULL AND existing.write_nonce = NEW.write_nonce)
)
BEGIN
  SELECT RAISE(ABORT, 'assisted recovery case insert conflict');
END;

CREATE TRIGGER identity_assisted_recovery_review_insert_conflict_guard
BEFORE INSERT ON identity_assisted_recovery_review
WHEN EXISTS (
  SELECT 1 FROM identity_assisted_recovery_review AS existing
  WHERE existing.id = NEW.id OR existing.case_id = NEW.case_id
)
BEGIN
  SELECT RAISE(ABORT, 'assisted recovery review insert conflict');
END;

CREATE TRIGGER identity_assisted_recovery_authorization_insert_conflict_guard
BEFORE INSERT ON identity_assisted_recovery_authorization
WHEN EXISTS (
  SELECT 1 FROM identity_assisted_recovery_authorization AS existing
  WHERE existing.id = NEW.id
    OR existing.case_id = NEW.case_id
    OR existing.secret_hash = NEW.secret_hash
    OR (NEW.consumed_auth_intent_id IS NOT NULL
      AND existing.consumed_auth_intent_id = NEW.consumed_auth_intent_id)
    OR (NEW.consume_nonce IS NOT NULL AND existing.consume_nonce = NEW.consume_nonce)
)
BEGIN
  SELECT RAISE(ABORT, 'assisted recovery authorization insert conflict');
END;

CREATE TRIGGER identity_passkey_enrollment_authorization_insert_conflict_guard
BEFORE INSERT ON identity_passkey_enrollment_authorization
WHEN EXISTS (
  SELECT 1 FROM identity_passkey_enrollment_authorization AS existing
  WHERE existing.auth_intent_id = NEW.auth_intent_id
)
BEGIN
  SELECT RAISE(ABORT, 'passkey enrollment authorization insert conflict');
END;

CREATE TRIGGER identity_legacy_admin_bootstrap_insert_conflict_guard
BEFORE INSERT ON identity_legacy_admin_bootstrap
WHEN EXISTS (
  SELECT 1 FROM identity_legacy_admin_bootstrap AS existing
  WHERE existing.legacy_admin_id = NEW.legacy_admin_id
    OR existing.secret_hash = NEW.secret_hash
    OR existing.expected_account_id = NEW.expected_account_id
    OR (NEW.consume_nonce IS NOT NULL AND existing.consume_nonce = NEW.consume_nonce)
    OR (NEW.password_credential_id IS NOT NULL
      AND existing.password_credential_id = NEW.password_credential_id)
    OR (NEW.owner_role_assignment_id IS NOT NULL
      AND existing.owner_role_assignment_id = NEW.owner_role_assignment_id)
    OR (NEW.write_nonce IS NOT NULL AND existing.write_nonce = NEW.write_nonce)
)
BEGIN
  SELECT RAISE(ABORT, 'legacy admin bootstrap insert conflict');
END;

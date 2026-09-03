-- Self-service account creation, moderated membership, password authentication, and recovery.
--
-- This migration deliberately keeps request proofs, password material, and recovery authorizations
-- out of D1. Only hashes or one-way password verifiers are persisted.

-- `identity_reviewer` is a narrow platform role. It does not inherit general platform-owner
-- capabilities in application policy; it exists only for the identity moderation capability.
DROP TRIGGER IF EXISTS identity_role_assignment_update_guard;
DROP TRIGGER IF EXISTS identity_role_assignment_insert_conflict_guard;
DROP INDEX IF EXISTS identity_role_active_platform_idx;
DROP INDEX IF EXISTS identity_role_active_tournament_idx;
DROP INDEX IF EXISTS identity_role_tournament_idx;
DROP INDEX IF EXISTS identity_role_assignment_write_nonce_idx;

ALTER TABLE identity_role_assignment RENAME TO identity_role_assignment_before_moderation;

CREATE TABLE identity_role_assignment (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (length(id) = 43 AND id NOT GLOB '*[^A-Za-z0-9_-]*'),
  account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  role TEXT NOT NULL COLLATE BINARY
    CHECK (
      role IN (
        'platform_owner',
        'identity_reviewer',
        'organizer',
        'referee',
        'check_in_operator'
      )
    ),
  scope_type TEXT NOT NULL COLLATE BINARY
    CHECK (scope_type IN ('platform', 'tournament')),
  scope_tournament_id INTEGER
    REFERENCES tournament(id) ON DELETE CASCADE,
  granted_by_account_id TEXT COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  grant_reason TEXT NOT NULL
    CHECK (length(grant_reason) BETWEEN 1 AND 500 AND grant_reason = trim(grant_reason)),
  granted_at INTEGER NOT NULL
    CHECK (typeof(granted_at) = 'integer' AND granted_at >= 0),
  expires_at INTEGER
    CHECK (expires_at IS NULL OR (typeof(expires_at) = 'integer' AND expires_at > granted_at)),
  revoked_by_account_id TEXT COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  revoke_reason TEXT
    CHECK (
      revoke_reason IS NULL
      OR (length(revoke_reason) BETWEEN 1 AND 500 AND revoke_reason = trim(revoke_reason))
    ),
  revoked_at INTEGER
    CHECK (revoked_at IS NULL OR (typeof(revoked_at) = 'integer' AND revoked_at >= granted_at)),
  revision INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(revision) = 'integer' AND revision >= 0),
  write_nonce TEXT COLLATE BINARY
    CHECK (
      write_nonce IS NULL
      OR (length(write_nonce) = 43 AND write_nonce NOT GLOB '*[^A-Za-z0-9_-]*')
    ),
  CHECK (
    (role IN ('platform_owner', 'identity_reviewer')
      AND scope_type = 'platform'
      AND scope_tournament_id IS NULL)
    OR
    (role NOT IN ('platform_owner', 'identity_reviewer')
      AND scope_type = 'tournament'
      AND scope_tournament_id IS NOT NULL)
  ),
  CHECK (
    (revoked_at IS NULL AND revoked_by_account_id IS NULL AND revoke_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
  )
);

INSERT INTO identity_role_assignment
SELECT * FROM identity_role_assignment_before_moderation;

DROP TABLE identity_role_assignment_before_moderation;

CREATE UNIQUE INDEX identity_role_active_platform_idx
ON identity_role_assignment(account_id, role)
WHERE scope_type = 'platform' AND revoked_at IS NULL;

CREATE UNIQUE INDEX identity_role_active_tournament_idx
ON identity_role_assignment(account_id, role, scope_tournament_id)
WHERE scope_type = 'tournament' AND revoked_at IS NULL;

CREATE INDEX identity_role_tournament_idx
ON identity_role_assignment(scope_tournament_id, role, account_id)
WHERE scope_type = 'tournament' AND revoked_at IS NULL;

CREATE UNIQUE INDEX identity_role_assignment_write_nonce_idx
ON identity_role_assignment(write_nonce)
WHERE write_nonce IS NOT NULL;

CREATE TRIGGER identity_role_assignment_update_guard
BEFORE UPDATE ON identity_role_assignment
WHEN NEW.id IS NOT OLD.id
  OR NEW.account_id IS NOT OLD.account_id
  OR NEW.role IS NOT OLD.role
  OR NEW.scope_type IS NOT OLD.scope_type
  OR NEW.scope_tournament_id IS NOT OLD.scope_tournament_id
  OR NEW.granted_by_account_id IS NOT OLD.granted_by_account_id
  OR NEW.grant_reason IS NOT OLD.grant_reason
  OR NEW.granted_at IS NOT OLD.granted_at
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
  OR OLD.revoked_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'role assignment revision conflict');
END;

CREATE TRIGGER identity_role_assignment_insert_conflict_guard
BEFORE INSERT ON identity_role_assignment
WHEN EXISTS (
  SELECT 1 FROM identity_role_assignment AS existing
  WHERE existing.id = NEW.id
    OR (NEW.write_nonce IS NOT NULL AND existing.write_nonce = NEW.write_nonce)
    OR (NEW.revoked_at IS NULL AND existing.revoked_at IS NULL
      AND NEW.scope_type = 'platform' AND existing.scope_type = 'platform'
      AND existing.account_id = NEW.account_id AND existing.role = NEW.role)
    OR (NEW.revoked_at IS NULL AND existing.revoked_at IS NULL
      AND NEW.scope_type = 'tournament' AND existing.scope_type = 'tournament'
      AND existing.account_id = NEW.account_id AND existing.role = NEW.role
      AND existing.scope_tournament_id = NEW.scope_tournament_id)
)
BEGIN
  SELECT RAISE(ABORT, 'role assignment insert conflict');
END;

-- SQLite cannot add a checked enum value or a provenance column in place. Rebuild the session
-- table while preserving IDs, hashes, assurance, and all existing foreign-key relationships.
PRAGMA foreign_keys = OFF;
PRAGMA legacy_alter_table = ON;

DROP TRIGGER IF EXISTS identity_session_security_version_insert_guard;
DROP TRIGGER IF EXISTS identity_session_passkey_insert_guard;
DROP TRIGGER IF EXISTS identity_session_assisted_recovery_disabled;
DROP TRIGGER IF EXISTS identity_session_update_guard;
DROP TRIGGER IF EXISTS identity_session_recovery_context_insert_guard;
DROP TRIGGER IF EXISTS identity_session_recovery_code_insert_guard;
DROP TRIGGER IF EXISTS identity_session_insert_conflict_guard;
DROP INDEX IF EXISTS identity_session_account_idx;
DROP INDEX IF EXISTS identity_session_expiry_idx;
DROP INDEX IF EXISTS identity_session_write_nonce_idx;

ALTER TABLE identity_session RENAME TO identity_session_before_password;

CREATE TABLE identity_session (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (length(id) = 43 AND id NOT GLOB '*[^A-Za-z0-9_-]*'),
  token_hash TEXT NOT NULL UNIQUE COLLATE BINARY
    CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  security_version INTEGER NOT NULL
    CHECK (typeof(security_version) = 'integer' AND security_version >= 0),
  auth_method TEXT NOT NULL COLLATE BINARY
    CHECK (
      auth_method IN (
        'passkey',
        'password',
        'oidc',
        'cas',
        'email_otp',
        'recovery_code',
        'assisted_recovery',
        'bootstrap'
      )
    ),
  authenticator_credential_id TEXT COLLATE BINARY,
  password_credential_id TEXT COLLATE BINARY,
  password_verification_nonce TEXT UNIQUE COLLATE BINARY
    CHECK (
      password_verification_nonce IS NULL
      OR (length(password_verification_nonce) = 43
        AND password_verification_nonce NOT GLOB '*[^A-Za-z0-9_-]*')
    ),
  passkey_auth_intent_id TEXT UNIQUE COLLATE BINARY
    REFERENCES identity_auth_intent(id) ON DELETE RESTRICT,
  recovery_code_id TEXT UNIQUE COLLATE BINARY
    REFERENCES identity_recovery_code(id) ON DELETE RESTRICT,
  recovery_auth_intent_id TEXT UNIQUE COLLATE BINARY
    REFERENCES identity_auth_intent(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL
    CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  last_seen_at INTEGER NOT NULL
    CHECK (typeof(last_seen_at) = 'integer' AND last_seen_at >= created_at),
  idle_expires_at INTEGER NOT NULL
    CHECK (typeof(idle_expires_at) = 'integer' AND idle_expires_at > last_seen_at),
  absolute_expires_at INTEGER NOT NULL
    CHECK (
      typeof(absolute_expires_at) = 'integer'
      AND absolute_expires_at >= idle_expires_at
      AND absolute_expires_at <= created_at + 2592000000
    ),
  authenticated_at INTEGER NOT NULL
    CHECK (typeof(authenticated_at) = 'integer' AND authenticated_at BETWEEN created_at AND last_seen_at),
  phishing_resistant_at INTEGER
    CHECK (
      phishing_resistant_at IS NULL
      OR (typeof(phishing_resistant_at) = 'integer'
        AND phishing_resistant_at BETWEEN created_at AND last_seen_at)
    ),
  recovery_verified_at INTEGER
    CHECK (
      recovery_verified_at IS NULL
      OR (typeof(recovery_verified_at) = 'integer'
        AND recovery_verified_at BETWEEN created_at AND last_seen_at)
    ),
  recovery_restricted INTEGER NOT NULL DEFAULT 0
    CHECK (recovery_restricted IN (0, 1)),
  display_metadata_json TEXT NOT NULL DEFAULT '{}'
    CHECK (
      length(display_metadata_json) <= 2048
      AND CASE WHEN json_valid(display_metadata_json)
        THEN json_type(display_metadata_json) = 'object' ELSE 0 END
    ),
  revoked_at INTEGER
    CHECK (revoked_at IS NULL OR (typeof(revoked_at) = 'integer' AND revoked_at >= created_at)),
  revoke_reason TEXT
    CHECK (
      revoke_reason IS NULL
      OR (length(revoke_reason) BETWEEN 1 AND 160 AND revoke_reason = trim(revoke_reason))
    ),
  revision INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(revision) = 'integer' AND revision >= 0),
  write_nonce TEXT COLLATE BINARY
    CHECK (
      write_nonce IS NULL
      OR (length(write_nonce) = 43 AND write_nonce NOT GLOB '*[^A-Za-z0-9_-]*')
    ),
  FOREIGN KEY (authenticator_credential_id, account_id)
    REFERENCES identity_passkey_credential(credential_id, account_id) ON DELETE RESTRICT,
  CHECK (
    (auth_method = 'passkey'
      AND authenticator_credential_id IS NOT NULL
      AND passkey_auth_intent_id IS NOT NULL)
    OR
    (auth_method != 'passkey'
      AND authenticator_credential_id IS NULL
      AND passkey_auth_intent_id IS NULL)
  ),
  CHECK (
    (auth_method = 'password'
      AND password_credential_id IS NOT NULL
      AND password_verification_nonce IS NOT NULL)
    OR
    (auth_method != 'password'
      AND password_credential_id IS NULL
      AND password_verification_nonce IS NULL)
  ),
  CHECK (
    (auth_method = 'recovery_code' AND recovery_code_id IS NOT NULL)
    OR (auth_method != 'recovery_code' AND recovery_code_id IS NULL)
  ),
  CHECK (
    (auth_method = 'passkey' AND phishing_resistant_at IS NOT NULL)
    OR (auth_method != 'passkey' AND phishing_resistant_at IS NULL)
  ),
  CHECK (
    (recovery_auth_intent_id IS NOT NULL
      AND recovery_verified_at IS NOT NULL
      AND recovery_restricted = 1)
    OR
    (recovery_auth_intent_id IS NULL
      AND recovery_verified_at IS NULL
      AND recovery_restricted = 0)
  ),
  CHECK (
    recovery_restricted = 0
    OR auth_method IN ('oidc', 'cas', 'email_otp', 'recovery_code', 'assisted_recovery')
  ),
  CHECK (
    auth_method NOT IN ('recovery_code', 'assisted_recovery')
    OR recovery_restricted = 1
  ),
  CHECK (
    (revoked_at IS NULL AND revoke_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
  )
);

INSERT INTO identity_session (
  id, token_hash, account_id, security_version, auth_method, authenticator_credential_id,
  password_verification_nonce,
  passkey_auth_intent_id, recovery_code_id, recovery_auth_intent_id, created_at, last_seen_at,
  idle_expires_at, absolute_expires_at, authenticated_at, phishing_resistant_at,
  recovery_verified_at, recovery_restricted, display_metadata_json, revoked_at, revoke_reason,
  revision, write_nonce
)
SELECT
  id, token_hash, account_id, security_version, auth_method, authenticator_credential_id,
  NULL,
  passkey_auth_intent_id, recovery_code_id, recovery_auth_intent_id, created_at, last_seen_at,
  idle_expires_at, absolute_expires_at, authenticated_at, phishing_resistant_at,
  recovery_verified_at, recovery_restricted, display_metadata_json, revoked_at, revoke_reason,
  revision, write_nonce
FROM identity_session_before_password;

DROP TABLE identity_session_before_password;

PRAGMA legacy_alter_table = OFF;
PRAGMA foreign_keys = ON;

CREATE INDEX identity_session_account_idx
ON identity_session(account_id, revoked_at, absolute_expires_at);

CREATE INDEX identity_session_expiry_idx
ON identity_session(idle_expires_at, absolute_expires_at)
WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX identity_session_write_nonce_idx
ON identity_session(write_nonce)
WHERE write_nonce IS NOT NULL;

CREATE TABLE identity_self_registration (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (length(id) = 43 AND id NOT GLOB '*[^A-Za-z0-9_-]*'),
  request_proof_hash TEXT NOT NULL UNIQUE COLLATE BINARY
    CHECK (length(request_proof_hash) = 64 AND request_proof_hash NOT GLOB '*[^0-9a-f]*'),
  expected_account_id TEXT NOT NULL UNIQUE COLLATE BINARY
    CHECK (length(expected_account_id) = 43 AND expected_account_id NOT GLOB '*[^A-Za-z0-9_-]*'),
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
  requested_display_name TEXT NOT NULL
    CHECK (
      length(requested_display_name) BETWEEN 1 AND 80
      AND requested_display_name = trim(requested_display_name)
    ),
  created_at INTEGER NOT NULL
    CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  expires_at INTEGER NOT NULL
    CHECK (
      typeof(expires_at) = 'integer'
      AND expires_at > created_at
      AND expires_at <= created_at + 600000
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
  CHECK (
    (consumed_at IS NULL AND consume_nonce IS NULL AND password_credential_id IS NULL)
    OR (consumed_at IS NOT NULL AND consume_nonce IS NOT NULL AND password_credential_id IS NOT NULL)
  )
);

CREATE INDEX identity_self_registration_expiry_idx
ON identity_self_registration(expires_at)
WHERE consumed_at IS NULL;

CREATE TRIGGER identity_self_registration_fresh_insert_guard
BEFORE INSERT ON identity_self_registration
WHEN NEW.consumed_at IS NOT NULL
  OR NEW.consume_nonce IS NOT NULL
  OR NEW.password_credential_id IS NOT NULL
  OR EXISTS (SELECT 1 FROM identity_account WHERE id = NEW.expected_account_id)
BEGIN
  SELECT RAISE(ABORT, 'self registration must start fresh');
END;

CREATE TRIGGER identity_self_registration_update_guard
BEFORE UPDATE ON identity_self_registration
WHEN NEW.id IS NOT OLD.id
  OR NEW.request_proof_hash IS NOT OLD.request_proof_hash
  OR NEW.expected_account_id IS NOT OLD.expected_account_id
  OR NEW.requested_username IS NOT OLD.requested_username
  OR NEW.requested_display_name IS NOT OLD.requested_display_name
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.expires_at IS NOT OLD.expires_at
  OR OLD.consumed_at IS NOT NULL
  OR NEW.consumed_at IS NULL
  OR NEW.consume_nonce IS NULL
  OR NEW.password_credential_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'self registration consumption conflict');
END;

CREATE TRIGGER identity_self_registration_delete_guard
BEFORE DELETE ON identity_self_registration
BEGIN
  SELECT RAISE(ABORT, 'self registrations are retained');
END;

CREATE TABLE identity_membership_application (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (length(id) = 43 AND id NOT GLOB '*[^A-Za-z0-9_-]*'),
  account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  identity_claim TEXT
    CHECK (
      identity_claim IS NULL
      OR (length(identity_claim) BETWEEN 3 AND 160 AND identity_claim = trim(identity_claim))
    ),
  contact TEXT
    CHECK (
      contact IS NULL
      OR (length(contact) BETWEEN 3 AND 160 AND contact = trim(contact))
    ),
  application_reason TEXT
    CHECK (
      application_reason IS NULL
      OR (length(application_reason) BETWEEN 1 AND 500 AND application_reason = trim(application_reason))
    ),
  status TEXT NOT NULL COLLATE BINARY DEFAULT 'draft'
    CHECK (
      status IN (
        'draft',
        'pending',
        'in_review',
        'changes_requested',
        'approved',
        'rejected',
        'withdrawn'
      )
    ),
  submission_version INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(submission_version) = 'integer' AND submission_version >= 0),
  submission_digest TEXT COLLATE BINARY
    CHECK (
      submission_digest IS NULL
      OR (length(submission_digest) = 64 AND submission_digest NOT GLOB '*[^0-9a-f]*')
    ),
  submitted_at INTEGER
    CHECK (submitted_at IS NULL OR (typeof(submitted_at) = 'integer' AND submitted_at >= 0)),
  assigned_reviewer_account_id TEXT COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  assigned_reviewer_session_id TEXT COLLATE BINARY
    REFERENCES identity_session(id) ON DELETE RESTRICT,
  review_started_at INTEGER
    CHECK (
      review_started_at IS NULL
      OR (typeof(review_started_at) = 'integer' AND review_started_at >= 0)
    ),
  latest_review_id TEXT COLLATE BINARY
    REFERENCES identity_membership_review(id) ON DELETE RESTRICT,
  latest_reviewed_at INTEGER
    CHECK (
      latest_reviewed_at IS NULL
      OR (typeof(latest_reviewed_at) = 'integer' AND latest_reviewed_at >= 0)
    ),
  last_applicant_update_at INTEGER NOT NULL
    CHECK (typeof(last_applicant_update_at) = 'integer' AND last_applicant_update_at >= 0),
  last_applicant_session_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_session(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL
    CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (typeof(updated_at) = 'integer' AND updated_at >= created_at),
  revision INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(revision) = 'integer' AND revision >= 0),
  write_nonce TEXT COLLATE BINARY
    CHECK (
      write_nonce IS NULL
      OR (length(write_nonce) = 43 AND write_nonce NOT GLOB '*[^A-Za-z0-9_-]*')
    ),
  CHECK (
    (status = 'draft' AND submission_digest IS NULL AND submitted_at IS NULL)
    OR
    (status IN ('pending', 'in_review', 'changes_requested', 'approved', 'rejected')
      AND submission_version >= 1
      AND submission_digest IS NOT NULL
      AND submitted_at IS NOT NULL)
    OR
    (status = 'withdrawn'
      AND (
        (submission_digest IS NULL AND submitted_at IS NULL)
        OR (submission_version >= 1 AND submission_digest IS NOT NULL AND submitted_at IS NOT NULL)
      ))
  ),
  CHECK (
    status IN ('draft', 'withdrawn')
    OR (identity_claim IS NOT NULL AND contact IS NOT NULL)
  ),
  CHECK (last_applicant_update_at BETWEEN created_at AND updated_at),
  CHECK (submitted_at IS NULL OR submitted_at BETWEEN created_at AND updated_at),
  CHECK (review_started_at IS NULL OR review_started_at BETWEEN submitted_at AND updated_at),
  CHECK (latest_reviewed_at IS NULL OR latest_reviewed_at BETWEEN created_at AND updated_at),
  CHECK (
    (latest_review_id IS NULL AND latest_reviewed_at IS NULL)
    OR (latest_review_id IS NOT NULL AND latest_reviewed_at IS NOT NULL)
  ),
  CHECK (
    (assigned_reviewer_account_id IS NULL
      AND assigned_reviewer_session_id IS NULL
      AND review_started_at IS NULL)
    OR
    (assigned_reviewer_account_id IS NOT NULL
      AND assigned_reviewer_session_id IS NOT NULL
      AND review_started_at IS NOT NULL)
  ),
  CHECK (
    (status IN ('draft', 'pending')
      AND assigned_reviewer_account_id IS NULL
      AND assigned_reviewer_session_id IS NULL
      AND review_started_at IS NULL)
    OR
    (status IN ('in_review', 'changes_requested', 'approved', 'rejected')
      AND assigned_reviewer_account_id IS NOT NULL
      AND assigned_reviewer_session_id IS NOT NULL
      AND review_started_at IS NOT NULL)
    OR status = 'withdrawn'
  ),
  CHECK (
    status NOT IN ('changes_requested', 'approved', 'rejected')
    OR latest_review_id IS NOT NULL
  )
);

CREATE INDEX identity_membership_application_queue_idx
ON identity_membership_application(status, submitted_at)
WHERE status IN ('pending', 'in_review');

CREATE UNIQUE INDEX identity_membership_application_one_open_idx
ON identity_membership_application(account_id)
WHERE status IN ('draft', 'pending', 'in_review', 'changes_requested');

CREATE UNIQUE INDEX identity_membership_application_write_nonce_idx
ON identity_membership_application(write_nonce)
WHERE write_nonce IS NOT NULL;

CREATE TABLE identity_membership_review (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (length(id) = 43 AND id NOT GLOB '*[^A-Za-z0-9_-]*'),
  application_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_membership_application(id) ON DELETE RESTRICT,
  submission_version INTEGER NOT NULL
    CHECK (typeof(submission_version) = 'integer' AND submission_version >= 1),
  submission_digest TEXT NOT NULL COLLATE BINARY
    CHECK (length(submission_digest) = 64 AND submission_digest NOT GLOB '*[^0-9a-f]*'),
  reviewer_account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  reviewer_session_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_session(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL COLLATE BINARY
    CHECK (decision IN ('approved', 'changes_requested', 'rejected')),
  reason TEXT NOT NULL
    CHECK (length(reason) BETWEEN 3 AND 1000 AND reason = trim(reason)),
  decided_at INTEGER NOT NULL
    CHECK (typeof(decided_at) = 'integer' AND decided_at >= 0),
  request_correlation_id TEXT NOT NULL COLLATE BINARY
    CHECK (
      length(request_correlation_id) BETWEEN 16 AND 128
      AND request_correlation_id NOT GLOB '*[^A-Za-z0-9_.:-]*'
    ),
  UNIQUE (application_id, submission_version)
);

CREATE INDEX identity_membership_review_reviewer_idx
ON identity_membership_review(reviewer_account_id, decided_at DESC);

CREATE TABLE identity_membership (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (length(id) = 43 AND id NOT GLOB '*[^A-Za-z0-9_-]*'),
  account_id TEXT NOT NULL UNIQUE COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  application_id TEXT NOT NULL UNIQUE COLLATE BINARY
    REFERENCES identity_membership_application(id) ON DELETE RESTRICT,
  approved_review_id TEXT NOT NULL UNIQUE COLLATE BINARY
    REFERENCES identity_membership_review(id) ON DELETE RESTRICT,
  status TEXT NOT NULL COLLATE BINARY DEFAULT 'approved'
    CHECK (status IN ('approved', 'revoked')),
  approved_at INTEGER NOT NULL
    CHECK (typeof(approved_at) = 'integer' AND approved_at >= 0),
  revoked_by_account_id TEXT COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  revoker_session_id TEXT COLLATE BINARY
    REFERENCES identity_session(id) ON DELETE RESTRICT,
  revoke_reason TEXT
    CHECK (
      revoke_reason IS NULL
      OR (length(revoke_reason) BETWEEN 3 AND 1000 AND revoke_reason = trim(revoke_reason))
    ),
  revoked_at INTEGER
    CHECK (
      revoked_at IS NULL
      OR (typeof(revoked_at) = 'integer' AND revoked_at >= approved_at)
    ),
  revision INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(revision) = 'integer' AND revision >= 0),
  write_nonce TEXT COLLATE BINARY
    CHECK (
      write_nonce IS NULL
      OR (length(write_nonce) = 43 AND write_nonce NOT GLOB '*[^A-Za-z0-9_-]*')
    ),
  CHECK (
    (status = 'approved' AND revoked_by_account_id IS NULL AND revoker_session_id IS NULL
      AND revoke_reason IS NULL AND revoked_at IS NULL)
    OR
    (status = 'revoked' AND revoked_by_account_id IS NOT NULL AND revoker_session_id IS NOT NULL
      AND revoke_reason IS NOT NULL AND revoked_at IS NOT NULL)
  )
);

CREATE INDEX identity_membership_status_idx
ON identity_membership(status, account_id);

CREATE UNIQUE INDEX identity_membership_write_nonce_idx
ON identity_membership(write_nonce)
WHERE write_nonce IS NOT NULL;

CREATE TRIGGER identity_membership_application_fresh_insert_guard
BEFORE INSERT ON identity_membership_application
WHEN NEW.status != 'draft'
  OR NEW.submission_version != 0
  OR NEW.submission_digest IS NOT NULL
  OR NEW.submitted_at IS NOT NULL
  OR NEW.latest_review_id IS NOT NULL
  OR NEW.latest_reviewed_at IS NOT NULL
  OR NEW.assigned_reviewer_account_id IS NOT NULL
  OR NEW.assigned_reviewer_session_id IS NOT NULL
  OR NEW.review_started_at IS NOT NULL
  OR NEW.last_applicant_update_at != NEW.created_at
  OR NEW.updated_at != NEW.created_at
  OR NEW.revision != 0
  OR NEW.write_nonce IS NOT NULL
  OR NOT EXISTS (
    SELECT 1
    FROM identity_account AS account
    JOIN identity_session AS applicant_session
      ON applicant_session.id = NEW.last_applicant_session_id
     AND applicant_session.account_id = account.id
    WHERE account.id = NEW.account_id
      AND account.status = 'active'
      AND account.security_version = applicant_session.security_version
      AND applicant_session.revoked_at IS NULL
      AND applicant_session.recovery_restricted = 0
      AND applicant_session.created_at <= NEW.created_at
      AND applicant_session.idle_expires_at > NEW.created_at
      AND applicant_session.absolute_expires_at > NEW.created_at
  )
  OR EXISTS (
    SELECT 1 FROM identity_membership
    WHERE account_id = NEW.account_id
  )
BEGIN
  SELECT RAISE(ABORT, 'membership application must start as an account draft');
END;

CREATE TRIGGER identity_membership_application_update_guard
BEFORE UPDATE ON identity_membership_application
WHEN NEW.id IS NOT OLD.id
  OR NEW.account_id IS NOT OLD.account_id
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.updated_at < OLD.updated_at
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
  OR OLD.status IN ('approved', 'rejected', 'withdrawn')
  OR NOT (
    (OLD.status = 'draft' AND NEW.status = 'draft'
      AND NEW.submission_version = OLD.submission_version
      AND NEW.latest_review_id IS OLD.latest_review_id
      AND NEW.latest_reviewed_at IS OLD.latest_reviewed_at
      AND NEW.last_applicant_update_at = NEW.updated_at)
    OR
    (OLD.status = 'draft' AND NEW.status = 'pending'
      AND NEW.submission_version = OLD.submission_version + 1
      AND NEW.submitted_at = NEW.updated_at
      AND NEW.latest_review_id IS OLD.latest_review_id
      AND NEW.latest_reviewed_at IS OLD.latest_reviewed_at
      AND NEW.last_applicant_update_at = NEW.updated_at)
    OR
    (OLD.status = 'pending' AND NEW.status = 'draft'
      AND NEW.submission_version = OLD.submission_version
      AND NEW.latest_review_id IS OLD.latest_review_id
      AND NEW.latest_reviewed_at IS OLD.latest_reviewed_at
      AND NEW.last_applicant_update_at = NEW.updated_at)
    OR
    (OLD.status = 'pending' AND NEW.status = 'in_review'
      AND NEW.submission_version = OLD.submission_version
      AND NEW.identity_claim IS OLD.identity_claim
      AND NEW.contact IS OLD.contact
      AND NEW.application_reason IS OLD.application_reason
      AND NEW.submission_digest IS OLD.submission_digest
      AND NEW.submitted_at IS OLD.submitted_at
      AND NEW.latest_review_id IS OLD.latest_review_id
      AND NEW.latest_reviewed_at IS OLD.latest_reviewed_at
      AND NEW.last_applicant_update_at = OLD.last_applicant_update_at
      AND NEW.last_applicant_session_id IS OLD.last_applicant_session_id
      AND NEW.review_started_at = NEW.updated_at)
    OR
    (OLD.status = 'in_review'
      AND NEW.status IN ('changes_requested', 'approved', 'rejected')
      AND NEW.submission_version = OLD.submission_version
      AND NEW.identity_claim IS OLD.identity_claim
      AND NEW.contact IS OLD.contact
      AND NEW.application_reason IS OLD.application_reason
      AND NEW.submission_digest IS OLD.submission_digest
      AND NEW.submitted_at IS OLD.submitted_at
      AND NEW.assigned_reviewer_account_id IS OLD.assigned_reviewer_account_id
      AND NEW.assigned_reviewer_session_id IS OLD.assigned_reviewer_session_id
      AND NEW.review_started_at IS OLD.review_started_at
      AND NEW.last_applicant_update_at = OLD.last_applicant_update_at
      AND NEW.last_applicant_session_id IS OLD.last_applicant_session_id
      AND NEW.latest_reviewed_at = NEW.updated_at)
    OR
    (OLD.status = 'changes_requested' AND NEW.status = 'draft'
      AND NEW.submission_version = OLD.submission_version
      AND NEW.latest_review_id IS OLD.latest_review_id
      AND NEW.latest_reviewed_at IS OLD.latest_reviewed_at
      AND NEW.last_applicant_update_at = NEW.updated_at)
    OR
    (OLD.status = 'changes_requested' AND NEW.status = 'pending'
      AND NEW.submission_version = OLD.submission_version + 1
      AND NEW.submitted_at = NEW.updated_at
      AND NEW.latest_review_id IS OLD.latest_review_id
      AND NEW.latest_reviewed_at IS OLD.latest_reviewed_at
      AND NEW.last_applicant_update_at = NEW.updated_at)
    OR
    (OLD.status IN ('draft', 'pending', 'in_review', 'changes_requested')
      AND NEW.status = 'withdrawn'
      AND NEW.submission_version = OLD.submission_version
      AND NEW.submission_digest IS OLD.submission_digest
      AND NEW.submitted_at IS OLD.submitted_at
      AND NEW.assigned_reviewer_account_id IS OLD.assigned_reviewer_account_id
      AND NEW.assigned_reviewer_session_id IS OLD.assigned_reviewer_session_id
      AND NEW.review_started_at IS OLD.review_started_at
      AND NEW.latest_review_id IS OLD.latest_review_id
      AND NEW.latest_reviewed_at IS OLD.latest_reviewed_at
      AND NEW.last_applicant_update_at = NEW.updated_at)
  )
BEGIN
  SELECT RAISE(ABORT, 'membership application state conflict');
END;

CREATE TRIGGER identity_membership_application_applicant_authority_guard
BEFORE UPDATE ON identity_membership_application
WHEN (
    (OLD.status = 'draft' AND NEW.status IN ('draft', 'pending', 'withdrawn'))
    OR (OLD.status = 'pending' AND NEW.status IN ('draft', 'withdrawn'))
    OR (OLD.status = 'in_review' AND NEW.status = 'withdrawn')
    OR (OLD.status = 'changes_requested'
      AND NEW.status IN ('draft', 'pending', 'withdrawn'))
  )
  AND NOT EXISTS (
    SELECT 1
    FROM identity_account AS account
    JOIN identity_session AS applicant_session
      ON applicant_session.id = NEW.last_applicant_session_id
     AND applicant_session.account_id = account.id
    WHERE account.id = OLD.account_id
      AND account.status = 'active'
      AND account.security_version = applicant_session.security_version
      AND applicant_session.revoked_at IS NULL
      AND applicant_session.recovery_restricted = 0
      AND applicant_session.created_at <= NEW.last_applicant_update_at
      AND applicant_session.idle_expires_at > NEW.last_applicant_update_at
      AND applicant_session.absolute_expires_at > NEW.last_applicant_update_at
  )
BEGIN
  SELECT RAISE(ABORT, 'membership application update requires the applicant session');
END;

CREATE TRIGGER identity_membership_application_claim_authority_guard
BEFORE UPDATE ON identity_membership_application
WHEN OLD.status = 'pending' AND NEW.status = 'in_review'
  AND NOT EXISTS (
    SELECT 1
    FROM identity_account AS reviewer
    JOIN identity_session AS reviewer_session
      ON reviewer_session.id = NEW.assigned_reviewer_session_id
     AND reviewer_session.account_id = reviewer.id
    JOIN identity_role_assignment AS assignment ON assignment.account_id = reviewer.id
    WHERE reviewer.id = NEW.assigned_reviewer_account_id
      AND reviewer.id != OLD.account_id
      AND reviewer.status = 'active'
      AND reviewer.security_version = reviewer_session.security_version
      AND reviewer_session.revoked_at IS NULL
      AND reviewer_session.recovery_restricted = 0
      AND reviewer_session.authenticated_at >= NEW.review_started_at - 900000
      AND reviewer_session.authenticated_at <= NEW.review_started_at
      AND reviewer_session.created_at <= NEW.review_started_at
      AND reviewer_session.idle_expires_at > NEW.review_started_at
      AND reviewer_session.absolute_expires_at > NEW.review_started_at
      AND assignment.scope_type = 'platform'
      AND assignment.role IN ('identity_reviewer', 'platform_owner')
      AND assignment.revoked_at IS NULL
      AND assignment.granted_at <= NEW.review_started_at
      AND (assignment.expires_at IS NULL OR assignment.expires_at > NEW.review_started_at)
  )
BEGIN
  SELECT RAISE(ABORT, 'membership review claim requires a current identity reviewer');
END;

CREATE TRIGGER identity_membership_review_authority_guard
BEFORE INSERT ON identity_membership_review
WHEN NOT EXISTS (
  SELECT 1
  FROM identity_account AS reviewer
  JOIN identity_session AS reviewer_session
    ON reviewer_session.id = NEW.reviewer_session_id
   AND reviewer_session.account_id = reviewer.id
  JOIN identity_role_assignment AS assignment ON assignment.account_id = reviewer.id
  JOIN identity_membership_application AS application ON application.id = NEW.application_id
  WHERE reviewer.id = NEW.reviewer_account_id
    AND reviewer.id = application.assigned_reviewer_account_id
    AND reviewer.id != application.account_id
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
  SELECT RAISE(ABORT, 'membership review requires a current identity reviewer');
END;

CREATE TRIGGER identity_membership_review_application_guard
BEFORE INSERT ON identity_membership_review
WHEN NOT EXISTS (
  SELECT 1
  FROM identity_membership_application AS application
  JOIN identity_account AS applicant ON applicant.id = application.account_id
  WHERE application.id = NEW.application_id
    AND application.status = 'in_review'
    AND application.submission_version = NEW.submission_version
    AND application.submission_digest = NEW.submission_digest
    AND application.submitted_at <= NEW.decided_at
    AND application.review_started_at <= NEW.decided_at
    AND application.assigned_reviewer_account_id = NEW.reviewer_account_id
    AND applicant.status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'membership application revision is not reviewable');
END;

CREATE TRIGGER identity_membership_review_update_guard
BEFORE UPDATE ON identity_membership_review
BEGIN
  SELECT RAISE(ABORT, 'membership reviews are append-only');
END;

CREATE TRIGGER identity_membership_review_delete_guard
BEFORE DELETE ON identity_membership_review
BEGIN
  SELECT RAISE(ABORT, 'membership reviews are retained');
END;

CREATE TRIGGER identity_membership_application_decision_guard
BEFORE UPDATE ON identity_membership_application
WHEN OLD.status = 'in_review'
  AND NEW.status IN ('changes_requested', 'approved', 'rejected')
  AND NOT EXISTS (
    SELECT 1 FROM identity_membership_review AS review
    WHERE review.id = NEW.latest_review_id
      AND review.application_id = OLD.id
      AND review.submission_version = OLD.submission_version
      AND review.submission_digest = OLD.submission_digest
      AND review.reviewer_account_id = OLD.assigned_reviewer_account_id
      AND review.decision = NEW.status
      AND review.decided_at = NEW.latest_reviewed_at
  )
BEGIN
  SELECT RAISE(ABORT, 'membership decision proof mismatch');
END;

CREATE TRIGGER identity_membership_application_delete_guard
BEFORE DELETE ON identity_membership_application
BEGIN
  SELECT RAISE(ABORT, 'membership applications are retained');
END;

CREATE TRIGGER identity_membership_fresh_insert_guard
BEFORE INSERT ON identity_membership
WHEN NEW.status != 'approved'
  OR NEW.revoked_by_account_id IS NOT NULL
  OR NEW.revoker_session_id IS NOT NULL
  OR NEW.revoke_reason IS NOT NULL
  OR NEW.revoked_at IS NOT NULL
  OR NEW.revision != 0
  OR NEW.write_nonce IS NOT NULL
  OR NOT EXISTS (
    SELECT 1
    FROM identity_membership_application AS application
    JOIN identity_membership_review AS review ON review.id = NEW.approved_review_id
    JOIN identity_account AS account ON account.id = application.account_id
    WHERE application.id = NEW.application_id
      AND application.account_id = NEW.account_id
      AND application.status = 'approved'
      AND application.latest_review_id = review.id
      AND review.application_id = application.id
      AND review.submission_version = application.submission_version
      AND review.submission_digest = application.submission_digest
      AND review.decision = 'approved'
      AND review.decided_at = NEW.approved_at
      AND account.status = 'active'
  )
BEGIN
  SELECT RAISE(ABORT, 'membership requires an approved application revision');
END;

CREATE TRIGGER identity_membership_update_guard
BEFORE UPDATE ON identity_membership
WHEN NEW.id IS NOT OLD.id
  OR NEW.account_id IS NOT OLD.account_id
  OR NEW.application_id IS NOT OLD.application_id
  OR NEW.approved_review_id IS NOT OLD.approved_review_id
  OR NEW.approved_at IS NOT OLD.approved_at
  OR OLD.status != 'approved'
  OR NEW.status != 'revoked'
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
  OR NOT EXISTS (
    SELECT 1
    FROM identity_account AS reviewer
    JOIN identity_session AS reviewer_session
      ON reviewer_session.id = NEW.revoker_session_id
     AND reviewer_session.account_id = reviewer.id
    JOIN identity_role_assignment AS assignment ON assignment.account_id = reviewer.id
    WHERE reviewer.id = NEW.revoked_by_account_id
      AND reviewer.status = 'active'
      AND reviewer.security_version = reviewer_session.security_version
      AND reviewer_session.revoked_at IS NULL
      AND reviewer_session.recovery_restricted = 0
      AND reviewer_session.authenticated_at >= NEW.revoked_at - 900000
      AND reviewer_session.authenticated_at <= NEW.revoked_at
      AND reviewer_session.created_at <= NEW.revoked_at
      AND reviewer_session.idle_expires_at > NEW.revoked_at
      AND reviewer_session.absolute_expires_at > NEW.revoked_at
      AND assignment.scope_type = 'platform'
      AND assignment.role IN ('identity_reviewer', 'platform_owner')
      AND assignment.revoked_at IS NULL
      AND assignment.granted_at <= NEW.revoked_at
      AND (assignment.expires_at IS NULL OR assignment.expires_at > NEW.revoked_at)
  )
BEGIN
  SELECT RAISE(ABORT, 'membership revocation requires a current identity reviewer');
END;

CREATE TRIGGER identity_membership_delete_guard
BEFORE DELETE ON identity_membership
BEGIN
  SELECT RAISE(ABORT, 'memberships are retained');
END;

CREATE TABLE identity_password_credential (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (length(id) = 43 AND id NOT GLOB '*[^A-Za-z0-9_-]*'),
  account_id TEXT NOT NULL UNIQUE COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  username TEXT NOT NULL UNIQUE COLLATE BINARY
    CHECK (
      length(username) BETWEEN 3 AND 32
      AND username = lower(trim(username))
      AND username GLOB '[a-z0-9]*'
      AND substr(username, -1, 1) GLOB '[a-z0-9]'
      AND username NOT GLOB '*[^a-z0-9_.-]*'
      AND username NOT IN (
        'account', 'admin', 'administrator', 'api', 'auth', 'cs2cup', 'help', 'login',
        'moderator', 'nbt', 'nlc', 'null', 'owner', 'root', 'security', 'staff',
        'support', 'system', 'undefined'
      )
    ),
  secret_version INTEGER NOT NULL DEFAULT 1
    CHECK (typeof(secret_version) = 'integer' AND secret_version >= 1),
  algorithm TEXT NOT NULL COLLATE BINARY
    CHECK (
      length(algorithm) BETWEEN 3 AND 32
      AND algorithm = lower(algorithm)
      AND algorithm GLOB '[a-z]*'
      AND algorithm NOT GLOB '*[^a-z0-9_-]*'
      AND algorithm NOT IN ('md5', 'sha1', 'sha256', 'sha512', 'plaintext')
    ),
  parameters_json TEXT NOT NULL
    CHECK (
      length(parameters_json) BETWEEN 2 AND 1024
      AND CASE WHEN json_valid(parameters_json)
        THEN json_type(parameters_json) = 'object' ELSE 0 END
    ),
  salt BLOB NOT NULL
    CHECK (typeof(salt) = 'blob' AND length(salt) BETWEEN 16 AND 64),
  password_hash BLOB NOT NULL
    CHECK (typeof(password_hash) = 'blob' AND length(password_hash) BETWEEN 32 AND 256),
  pepper_version INTEGER NOT NULL
    CHECK (typeof(pepper_version) = 'integer' AND pepper_version BETWEEN 1 AND 255),
  status TEXT NOT NULL COLLATE BINARY DEFAULT 'active'
    CHECK (status IN ('active', 'revoked')),
  failed_attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(failed_attempt_count) = 'integer' AND failed_attempt_count BETWEEN 0 AND 10000),
  last_failed_at INTEGER
    CHECK (last_failed_at IS NULL OR (typeof(last_failed_at) = 'integer' AND last_failed_at >= 0)),
  locked_until INTEGER
    CHECK (
      locked_until IS NULL
      OR (typeof(locked_until) = 'integer'
        AND last_failed_at IS NOT NULL
        AND locked_until > last_failed_at
        AND locked_until <= last_failed_at + 86400000)
    ),
  last_authenticated_at INTEGER
    CHECK (
      last_authenticated_at IS NULL
      OR (typeof(last_authenticated_at) = 'integer' AND last_authenticated_at >= 0)
    ),
  registration_kind TEXT NOT NULL COLLATE BINARY
    CHECK (registration_kind IN ('self_registration', 'legacy_admin_bootstrap')),
  self_registration_id TEXT UNIQUE COLLATE BINARY
    REFERENCES identity_self_registration(id) ON DELETE RESTRICT,
  legacy_admin_bootstrap_id INTEGER UNIQUE
    REFERENCES identity_legacy_admin_bootstrap(legacy_admin_id) ON DELETE RESTRICT,
  last_change_id TEXT UNIQUE COLLATE BINARY
    REFERENCES identity_password_change(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL
    CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (typeof(updated_at) = 'integer' AND updated_at >= created_at),
  revoked_at INTEGER
    CHECK (revoked_at IS NULL OR (typeof(revoked_at) = 'integer' AND revoked_at >= created_at)),
  revision INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(revision) = 'integer' AND revision >= 0),
  write_nonce TEXT COLLATE BINARY
    CHECK (
      write_nonce IS NULL
      OR (length(write_nonce) = 43 AND write_nonce NOT GLOB '*[^A-Za-z0-9_-]*')
    ),
  UNIQUE (id, account_id),
  CHECK (
    (registration_kind = 'self_registration'
      AND self_registration_id IS NOT NULL
      AND legacy_admin_bootstrap_id IS NULL)
    OR
    (registration_kind = 'legacy_admin_bootstrap'
      AND self_registration_id IS NULL
      AND legacy_admin_bootstrap_id = 1)
  ),
  CHECK ((status = 'active' AND revoked_at IS NULL) OR (status = 'revoked' AND revoked_at IS NOT NULL)),
  CHECK (
    (failed_attempt_count = 0 AND last_failed_at IS NULL AND locked_until IS NULL)
    OR (failed_attempt_count > 0 AND last_failed_at IS NOT NULL)
  )
);

CREATE INDEX identity_password_credential_username_idx
ON identity_password_credential(username, status);

CREATE UNIQUE INDEX identity_password_credential_write_nonce_idx
ON identity_password_credential(write_nonce)
WHERE write_nonce IS NOT NULL;

CREATE TABLE identity_password_change (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (length(id) = 43 AND id NOT GLOB '*[^A-Za-z0-9_-]*'),
  credential_id TEXT NOT NULL COLLATE BINARY,
  account_id TEXT NOT NULL COLLATE BINARY,
  change_kind TEXT NOT NULL COLLATE BINARY
    CHECK (change_kind IN ('authenticated_change', 'assisted_recovery')),
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
    (change_kind = 'assisted_recovery'
      AND confirmation_auth_intent_id IS NULL
      AND assisted_recovery_case_id IS NOT NULL)
  )
);

CREATE INDEX identity_password_change_account_idx
ON identity_password_change(account_id, changed_at DESC);

CREATE INDEX identity_password_change_credential_idx
ON identity_password_change(credential_id, changed_at DESC);

CREATE TRIGGER identity_password_credential_fresh_insert_guard
BEFORE INSERT ON identity_password_credential
WHEN NEW.status != 'active'
  OR NEW.secret_version != 1
  OR NEW.failed_attempt_count != 0
  OR NEW.last_failed_at IS NOT NULL
  OR NEW.locked_until IS NOT NULL
  OR NEW.last_authenticated_at IS NOT NULL
  OR NEW.last_change_id IS NOT NULL
  OR NEW.revoked_at IS NOT NULL
  OR NEW.revision != 0
  OR NEW.write_nonce IS NOT NULL
  OR NOT (
    (
      NEW.registration_kind = 'self_registration'
      AND EXISTS (
        SELECT 1
        FROM identity_self_registration AS registration
        JOIN identity_account AS account ON account.id = registration.expected_account_id
        WHERE registration.id = NEW.self_registration_id
          AND registration.expected_account_id = NEW.account_id
          AND registration.requested_username = NEW.username
          AND registration.consumed_at IS NULL
          AND registration.created_at <= NEW.created_at
          AND registration.expires_at > NEW.created_at
          AND account.status = 'active'
          AND account.verification_state = 'legacy_unverified'
          AND account.display_name = registration.requested_display_name
      )
    )
    OR
    (
      NEW.registration_kind = 'legacy_admin_bootstrap'
      AND EXISTS (
        SELECT 1
        FROM identity_legacy_admin_bootstrap AS bootstrap
        JOIN identity_account AS account ON account.id = bootstrap.expected_account_id
        WHERE bootstrap.legacy_admin_id = NEW.legacy_admin_bootstrap_id
          AND bootstrap.status = 'open'
          AND bootstrap.expected_account_id = NEW.account_id
          AND bootstrap.issued_at <= NEW.created_at
          AND bootstrap.expires_at > NEW.created_at
          AND account.status = 'active'
          AND account.verification_state = 'legacy_unverified'
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'password credential requires self-registration or bootstrap provenance');
END;

CREATE TRIGGER identity_self_registration_consumption_proof_guard
BEFORE UPDATE ON identity_self_registration
WHEN OLD.consumed_at IS NULL
  AND NEW.consumed_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM identity_password_credential AS credential
    JOIN identity_account AS account ON account.id = credential.account_id
    WHERE credential.id = NEW.password_credential_id
      AND credential.self_registration_id = OLD.id
      AND credential.account_id = OLD.expected_account_id
      AND credential.username = OLD.requested_username
      AND credential.status = 'active'
      AND account.status = 'active'
      AND account.verification_state = 'legacy_unverified'
      AND account.display_name = OLD.requested_display_name
      AND NEW.consumed_at >= OLD.created_at
      AND NEW.consumed_at < OLD.expires_at
      AND credential.created_at <= NEW.consumed_at
  )
BEGIN
  SELECT RAISE(ABORT, 'self registration password proof mismatch');
END;

CREATE TABLE identity_password_change_confirmation (
  auth_intent_id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    REFERENCES identity_auth_intent(id) ON DELETE RESTRICT,
  account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  initiating_session_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_session(id) ON DELETE RESTRICT,
  confirmation_method TEXT NOT NULL COLLATE BINARY
    CHECK (confirmation_method IN ('password', 'passkey')),
  proof_credential_id TEXT NOT NULL COLLATE BINARY
    CHECK (length(proof_credential_id) BETWEEN 1 AND 1366),
  confirmed_at INTEGER NOT NULL
    CHECK (typeof(confirmed_at) = 'integer' AND confirmed_at >= 0),
  UNIQUE (auth_intent_id, account_id)
);

CREATE INDEX identity_password_change_confirmation_account_idx
ON identity_password_change_confirmation(account_id, confirmed_at DESC);

CREATE TRIGGER identity_password_change_confirmation_insert_guard
BEFORE INSERT ON identity_password_change_confirmation
WHEN NOT EXISTS (
  SELECT 1
  FROM identity_auth_intent AS confirmation_intent
  JOIN identity_session AS initiating_session
    ON initiating_session.id = NEW.initiating_session_id
   AND initiating_session.account_id = NEW.account_id
  JOIN identity_account AS account ON account.id = NEW.account_id
  WHERE confirmation_intent.id = NEW.auth_intent_id
    AND confirmation_intent.expected_account_id = NEW.account_id
    AND confirmation_intent.consumed_at = NEW.confirmed_at
    AND confirmation_intent.completion_result_ref = NEW.proof_credential_id
    AND confirmation_intent.created_at <= NEW.confirmed_at
    AND confirmation_intent.expires_at > NEW.confirmed_at
    AND initiating_session.revoked_at IS NULL
    AND initiating_session.recovery_restricted = 0
    AND initiating_session.security_version = account.security_version
    AND initiating_session.created_at <= NEW.confirmed_at
    AND initiating_session.idle_expires_at > NEW.confirmed_at
    AND initiating_session.absolute_expires_at > NEW.confirmed_at
    AND account.status = 'active'
    AND (
      (
        NEW.confirmation_method = 'password'
        AND confirmation_intent.purpose = 'sensitive_confirmation'
        AND confirmation_intent.completion_result_type = 'password_credential'
        AND EXISTS (
          SELECT 1 FROM identity_password_credential AS password_credential
          WHERE password_credential.id = NEW.proof_credential_id
            AND password_credential.account_id = NEW.account_id
            AND password_credential.status = 'active'
            AND password_credential.last_authenticated_at = NEW.confirmed_at
        )
      )
      OR
      (
        NEW.confirmation_method = 'passkey'
        AND confirmation_intent.purpose = 'passkey_step_up'
        AND confirmation_intent.initiating_session_id = NEW.initiating_session_id
        AND confirmation_intent.completion_result_type = 'passkey_credential'
        AND EXISTS (
          SELECT 1 FROM identity_passkey_credential AS passkey_credential
          WHERE passkey_credential.credential_id = NEW.proof_credential_id
            AND passkey_credential.account_id = NEW.account_id
            AND passkey_credential.status = 'active'
        )
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'password change confirmation proof mismatch');
END;

CREATE TRIGGER identity_password_change_confirmation_update_guard
BEFORE UPDATE ON identity_password_change_confirmation
BEGIN
  SELECT RAISE(ABORT, 'password change confirmations are immutable');
END;

CREATE TRIGGER identity_password_change_confirmation_delete_guard
BEFORE DELETE ON identity_password_change_confirmation
BEGIN
  SELECT RAISE(ABORT, 'password change confirmations are retained');
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

CREATE TRIGGER identity_password_credential_revocation_security_bump
AFTER UPDATE OF status ON identity_password_credential
WHEN OLD.status = 'active' AND NEW.status = 'revoked'
BEGIN
  UPDATE identity_account
  SET security_version = security_version + 1,
      updated_at = NEW.updated_at,
      revision = revision + 1,
      write_nonce = NEW.write_nonce
  WHERE id = NEW.account_id AND status = 'active';

  SELECT CASE WHEN changes() != 1
    THEN RAISE(ABORT, 'password revocation failed to advance account security version') END;
END;

CREATE TRIGGER identity_password_credential_delete_guard
BEFORE DELETE ON identity_password_credential
BEGIN
  SELECT RAISE(ABORT, 'password credentials are retained');
END;

CREATE TRIGGER identity_account_security_version_session_revocation
AFTER UPDATE OF security_version ON identity_account
WHEN NEW.security_version > OLD.security_version
BEGIN
  UPDATE identity_session
  SET revoked_at = NEW.updated_at,
      revoke_reason = 'account security version changed',
      revision = revision + 1,
      write_nonce = id
  WHERE account_id = NEW.id
    AND revoked_at IS NULL
    AND security_version < NEW.security_version;
END;

CREATE TRIGGER identity_account_self_registration_creation_guard
BEFORE INSERT ON identity_account
WHEN EXISTS (
  SELECT 1 FROM identity_self_registration
  WHERE expected_account_id = NEW.id
)
  AND NOT EXISTS (
    SELECT 1
    FROM identity_self_registration AS registration
    WHERE registration.expected_account_id = NEW.id
      AND registration.consumed_at IS NULL
      AND NEW.status = 'active'
      AND NEW.verification_state = 'legacy_unverified'
      AND NEW.display_name = registration.requested_display_name
      AND NEW.created_at >= registration.created_at
      AND NEW.created_at < registration.expires_at
  )
BEGIN
  SELECT RAISE(ABORT, 'account requires live self-registration provenance');
END;

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

PRAGMA defer_foreign_keys = ON;

CREATE TABLE identity_legacy_admin_bootstrap_copy AS
SELECT * FROM identity_legacy_admin_bootstrap;

DROP TABLE identity_legacy_admin_bootstrap;

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
)
;

INSERT INTO identity_legacy_admin_bootstrap
SELECT * FROM identity_legacy_admin_bootstrap_copy;

DROP TABLE identity_legacy_admin_bootstrap_copy;
DROP TABLE identity_role_assignment_before_project_scope;

CREATE UNIQUE INDEX identity_legacy_admin_bootstrap_write_nonce_idx
ON identity_legacy_admin_bootstrap(write_nonce)
WHERE write_nonce IS NOT NULL;

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

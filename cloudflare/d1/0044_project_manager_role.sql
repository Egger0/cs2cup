DROP TRIGGER IF EXISTS identity_role_assignment_update_guard;
DROP TRIGGER IF EXISTS identity_role_assignment_insert_conflict_guard;
DROP INDEX IF EXISTS identity_role_active_platform_idx;
DROP INDEX IF EXISTS identity_role_active_tournament_idx;
DROP INDEX IF EXISTS identity_role_tournament_idx;
DROP INDEX IF EXISTS identity_role_assignment_write_nonce_idx;

PRAGMA foreign_keys = OFF;
PRAGMA legacy_alter_table = ON;

ALTER TABLE identity_role_assignment RENAME TO identity_role_assignment_before_project_scope;

CREATE TABLE identity_role_assignment (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (length(id) = 43 AND id NOT GLOB '*[^A-Za-z0-9_-]*'),
  account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  role TEXT NOT NULL COLLATE BINARY
    CHECK (role IN ('platform_owner', 'identity_reviewer', 'project_manager', 'organizer', 'referee', 'check_in_operator')),
  scope_type TEXT NOT NULL COLLATE BINARY
    CHECK (scope_type IN ('platform', 'game', 'tournament')),
  scope_game_id INTEGER
    REFERENCES game(id) ON DELETE CASCADE,
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
    CHECK (revoke_reason IS NULL OR (length(revoke_reason) BETWEEN 1 AND 500 AND revoke_reason = trim(revoke_reason))),
  revoked_at INTEGER
    CHECK (revoked_at IS NULL OR (typeof(revoked_at) = 'integer' AND revoked_at >= granted_at)),
  revision INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(revision) = 'integer' AND revision >= 0),
  write_nonce TEXT COLLATE BINARY
    CHECK (write_nonce IS NULL OR (length(write_nonce) = 43 AND write_nonce NOT GLOB '*[^A-Za-z0-9_-]*')),
  CHECK (
    (role IN ('platform_owner', 'identity_reviewer')
      AND scope_type = 'platform' AND scope_game_id IS NULL AND scope_tournament_id IS NULL)
    OR (role = 'project_manager'
      AND scope_type = 'game' AND scope_game_id IS NOT NULL AND scope_tournament_id IS NULL)
    OR (role IN ('organizer', 'referee', 'check_in_operator')
      AND scope_type = 'tournament' AND scope_game_id IS NULL AND scope_tournament_id IS NOT NULL)
  ),
  CHECK (
    (revoked_at IS NULL AND revoked_by_account_id IS NULL AND revoke_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
  )
);

INSERT INTO identity_role_assignment (
  id, account_id, role, scope_type, scope_game_id, scope_tournament_id,
  granted_by_account_id, grant_reason, granted_at, expires_at,
  revoked_by_account_id, revoke_reason, revoked_at, revision, write_nonce
)
SELECT
  id, account_id, role, scope_type, NULL, scope_tournament_id,
  granted_by_account_id, grant_reason, granted_at, expires_at,
  revoked_by_account_id, revoke_reason, revoked_at, revision, write_nonce
FROM identity_role_assignment_before_project_scope;

-- Keep the renamed table as the foreign-key target for completed legacy owner
-- bootstrap evidence. D1 migrations run in a transaction, so foreign_keys cannot
-- be disabled around this table rebuild.

CREATE UNIQUE INDEX identity_role_active_platform_idx
ON identity_role_assignment(account_id, role)
WHERE scope_type = 'platform' AND revoked_at IS NULL;

CREATE UNIQUE INDEX identity_role_active_game_idx
ON identity_role_assignment(account_id, role, scope_game_id)
WHERE scope_type = 'game' AND revoked_at IS NULL;

CREATE UNIQUE INDEX identity_role_active_tournament_idx
ON identity_role_assignment(account_id, role, scope_tournament_id)
WHERE scope_type = 'tournament' AND revoked_at IS NULL;

CREATE INDEX identity_role_game_idx
ON identity_role_assignment(scope_game_id, role, account_id)
WHERE scope_type = 'game' AND revoked_at IS NULL;

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
  OR NEW.scope_game_id IS NOT OLD.scope_game_id
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
      AND NEW.scope_type = 'game' AND existing.scope_type = 'game'
      AND existing.account_id = NEW.account_id AND existing.role = NEW.role
      AND existing.scope_game_id = NEW.scope_game_id)
    OR (NEW.revoked_at IS NULL AND existing.revoked_at IS NULL
      AND NEW.scope_type = 'tournament' AND existing.scope_type = 'tournament'
      AND existing.account_id = NEW.account_id AND existing.role = NEW.role
      AND existing.scope_tournament_id = NEW.scope_tournament_id)
)
BEGIN
  SELECT RAISE(ABORT, 'role assignment insert conflict');
END;

PRAGMA legacy_alter_table = OFF;
PRAGMA foreign_keys = ON;

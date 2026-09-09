CREATE TABLE identity_registration_membership_next (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (
      length(id) = 43
      AND id NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
  team_id INTEGER NOT NULL
    REFERENCES team(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  relationship TEXT NOT NULL COLLATE BINARY
    CHECK (relationship IN ('owner', 'manager', 'player')),
  player_id INTEGER
    REFERENCES player(id) ON DELETE CASCADE,
  granted_by_account_id TEXT COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  grant_reason TEXT NOT NULL
    CHECK (
      length(grant_reason) BETWEEN 1 AND 500
      AND grant_reason = trim(grant_reason)
    ),
  granted_at INTEGER NOT NULL
    CHECK (typeof(granted_at) = 'integer' AND granted_at >= 0),
  expires_at INTEGER
    CHECK (
      expires_at IS NULL
      OR (typeof(expires_at) = 'integer' AND expires_at > granted_at)
    ),
  revoked_by_account_id TEXT COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  revoke_reason TEXT
    CHECK (
      revoke_reason IS NULL
      OR (length(revoke_reason) BETWEEN 1 AND 500 AND revoke_reason = trim(revoke_reason))
    ),
  revoked_at INTEGER
    CHECK (
      revoked_at IS NULL
      OR (typeof(revoked_at) = 'integer' AND revoked_at >= granted_at)
    ),
  revision INTEGER NOT NULL DEFAULT 0
    CHECK (typeof(revision) = 'integer' AND revision >= 0),
  write_nonce TEXT COLLATE BINARY
    CHECK (
      write_nonce IS NULL
      OR (
        length(write_nonce) = 43
        AND write_nonce NOT GLOB '*[^A-Za-z0-9_-]*'
      )
    ),
  CHECK (relationship != 'owner' OR expires_at IS NULL),
  CHECK (
    (relationship = 'player' AND player_id IS NOT NULL)
    OR
    (relationship != 'player' AND player_id IS NULL)
  ),
  CHECK (
    (revoked_at IS NULL AND revoked_by_account_id IS NULL AND revoke_reason IS NULL)
    OR
    (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
  )
);

INSERT INTO identity_registration_membership_next
  (id, team_id, account_id, relationship, player_id, granted_by_account_id, grant_reason,
   granted_at, expires_at, revoked_by_account_id, revoke_reason, revoked_at, revision, write_nonce)
SELECT
  id, team_id, account_id, relationship, NULL, granted_by_account_id, grant_reason,
  granted_at, expires_at, revoked_by_account_id, revoke_reason, revoked_at, revision, write_nonce
FROM identity_registration_membership;

DROP TABLE identity_registration_membership;

ALTER TABLE identity_registration_membership_next
  RENAME TO identity_registration_membership;

CREATE UNIQUE INDEX IF NOT EXISTS identity_registration_active_owner_idx
ON identity_registration_membership(team_id)
WHERE relationship = 'owner' AND revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS identity_registration_active_member_idx
ON identity_registration_membership(team_id, account_id, relationship)
WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS identity_registration_account_idx
ON identity_registration_membership(account_id, relationship, team_id)
WHERE revoked_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS identity_registration_membership_write_nonce_idx
ON identity_registration_membership(write_nonce)
WHERE write_nonce IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS identity_registration_membership_live_player_idx
ON identity_registration_membership(player_id)
WHERE player_id IS NOT NULL AND revoked_at IS NULL;

CREATE TRIGGER IF NOT EXISTS identity_registration_membership_update_guard
BEFORE UPDATE ON identity_registration_membership
WHEN NEW.id IS NOT OLD.id
  OR NEW.team_id IS NOT OLD.team_id
  OR NEW.account_id IS NOT OLD.account_id
  OR NEW.relationship IS NOT OLD.relationship
  OR NEW.player_id IS NOT OLD.player_id
  OR NEW.granted_by_account_id IS NOT OLD.granted_by_account_id
  OR NEW.grant_reason IS NOT OLD.grant_reason
  OR NEW.granted_at IS NOT OLD.granted_at
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
  OR OLD.revoked_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'registration membership revision conflict');
END;

CREATE TRIGGER IF NOT EXISTS identity_registration_membership_insert_conflict_guard
BEFORE INSERT ON identity_registration_membership
WHEN EXISTS (
  SELECT 1 FROM identity_registration_membership AS existing
  WHERE existing.id = NEW.id
    OR (NEW.write_nonce IS NOT NULL AND existing.write_nonce = NEW.write_nonce)
    OR (NEW.revoked_at IS NULL AND existing.revoked_at IS NULL
      AND existing.team_id = NEW.team_id
      AND existing.account_id = NEW.account_id
      AND existing.relationship = NEW.relationship)
    OR (NEW.revoked_at IS NULL AND NEW.relationship = 'owner'
      AND existing.revoked_at IS NULL AND existing.relationship = 'owner'
      AND existing.team_id = NEW.team_id)
)
BEGIN
  SELECT RAISE(ABORT, 'registration membership insert conflict');
END;

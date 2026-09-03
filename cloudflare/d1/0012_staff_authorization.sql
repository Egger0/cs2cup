CREATE TABLE IF NOT EXISTS platform_role_assignment (
  admin_id INTEGER PRIMARY KEY
    REFERENCES admin_account(id) ON DELETE CASCADE,
  role TEXT NOT NULL COLLATE BINARY DEFAULT 'platform_owner'
    CHECK (role = 'platform_owner'),
  granted_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    CHECK (typeof(granted_at) = 'integer' AND granted_at >= 0),
  expires_at INTEGER
    CHECK (
      expires_at IS NULL
      OR (typeof(expires_at) = 'integer' AND expires_at > granted_at)
    ),
  revoked_at INTEGER
    CHECK (
      revoked_at IS NULL
      OR (typeof(revoked_at) = 'integer' AND revoked_at >= granted_at)
    )
) WITHOUT ROWID;

INSERT OR IGNORE INTO platform_role_assignment (admin_id, role)
SELECT id, 'platform_owner'
FROM admin_account
WHERE id = 1;

CREATE TRIGGER IF NOT EXISTS platform_owner_assignment_after_admin_insert
AFTER INSERT ON admin_account
WHEN NEW.id = 1
BEGIN
  INSERT OR IGNORE INTO platform_role_assignment (admin_id, role)
  VALUES (NEW.id, 'platform_owner');
END;

CREATE TABLE IF NOT EXISTS tournament_role_assignment (
  tournament_id INTEGER NOT NULL
    REFERENCES tournament(id) ON DELETE CASCADE,
  principal_id TEXT NOT NULL COLLATE BINARY
    REFERENCES participant_principal(id) ON DELETE CASCADE,
  role TEXT NOT NULL COLLATE BINARY
    CHECK (role IN ('organizer', 'referee', 'check_in_operator')),
  granted_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    CHECK (typeof(granted_at) = 'integer' AND granted_at >= 0),
  expires_at INTEGER
    CHECK (
      expires_at IS NULL
      OR (typeof(expires_at) = 'integer' AND expires_at > granted_at)
    ),
  revoked_at INTEGER
    CHECK (
      revoked_at IS NULL
      OR (typeof(revoked_at) = 'integer' AND revoked_at >= granted_at)
    ),
  PRIMARY KEY (tournament_id, principal_id, role)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS tournament_role_assignment_principal_idx
ON tournament_role_assignment(principal_id, tournament_id, role);

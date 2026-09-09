CREATE TABLE identity_roster_claim_request (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (length(id) = 43 AND id NOT GLOB '*[^A-Za-z0-9_-]*'),
  player_id INTEGER NOT NULL REFERENCES player(id) ON DELETE CASCADE,
  invited_account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE CASCADE,
  inviter_account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  expires_at INTEGER NOT NULL CHECK (
    typeof(expires_at) = 'integer' AND expires_at > created_at AND expires_at <= created_at + 2592000000
  ),
  accepted_at INTEGER CHECK (
    accepted_at IS NULL OR (typeof(accepted_at) = 'integer' AND accepted_at >= created_at AND accepted_at < expires_at)
  ),
  revoked_at INTEGER CHECK (revoked_at IS NULL OR (typeof(revoked_at) = 'integer' AND revoked_at >= created_at)),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (typeof(revision) = 'integer' AND revision >= 0),
  write_nonce TEXT COLLATE BINARY CHECK (
    write_nonce IS NULL OR (length(write_nonce) = 43 AND write_nonce NOT GLOB '*[^A-Za-z0-9_-]*')
  ),
  CHECK (invited_account_id != inviter_account_id),
  CHECK ((accepted_at IS NULL AND revoked_at IS NULL) OR (accepted_at IS NOT NULL AND revoked_at IS NULL) OR (accepted_at IS NULL AND revoked_at IS NOT NULL))
);

CREATE UNIQUE INDEX identity_roster_claim_request_player_idx
ON identity_roster_claim_request(player_id)
WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX identity_roster_claim_request_inbox_idx
ON identity_roster_claim_request(invited_account_id, created_at DESC)
WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TRIGGER identity_roster_claim_request_update_guard
BEFORE UPDATE ON identity_roster_claim_request
WHEN NEW.id IS NOT OLD.id
  OR NEW.player_id IS NOT OLD.player_id
  OR NEW.invited_account_id IS NOT OLD.invited_account_id
  OR NEW.inviter_account_id IS NOT OLD.inviter_account_id
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
  OR OLD.accepted_at IS NOT NULL
  OR OLD.revoked_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'roster claim request revision conflict');
END;

CREATE TABLE identity_registration_draft (
  account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE CASCADE,
  tournament_id INTEGER NOT NULL
    REFERENCES tournament(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL
    CHECK (
      length(payload_json) BETWEEN 2 AND 8192
      AND json_valid(payload_json)
      AND json_type(payload_json) = 'object'
    ),
  created_at INTEGER NOT NULL
    CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  updated_at INTEGER NOT NULL
    CHECK (typeof(updated_at) = 'integer' AND updated_at >= created_at),
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
  PRIMARY KEY (account_id, tournament_id)
) WITHOUT ROWID;

CREATE INDEX identity_registration_draft_tournament_idx
ON identity_registration_draft(tournament_id, updated_at DESC, account_id);

CREATE UNIQUE INDEX identity_registration_draft_write_nonce_idx
ON identity_registration_draft(write_nonce)
WHERE write_nonce IS NOT NULL;

CREATE TRIGGER identity_registration_draft_update_guard
BEFORE UPDATE ON identity_registration_draft
WHEN NEW.account_id IS NOT OLD.account_id
  OR NEW.tournament_id IS NOT OLD.tournament_id
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.updated_at < OLD.updated_at
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
BEGIN
  SELECT RAISE(ABORT, 'registration draft revision conflict');
END;

CREATE TABLE identity_registration_token_redemption (
  token_hash TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (
      length(token_hash) = 64
      AND token_hash NOT GLOB '*[^0-9a-f]*'
    ),
  team_id INTEGER NOT NULL UNIQUE
    REFERENCES team(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  redeemed_at INTEGER NOT NULL
    CHECK (typeof(redeemed_at) = 'integer' AND redeemed_at >= 0),
  replay_expires_at INTEGER NOT NULL
    CHECK (
      typeof(replay_expires_at) = 'integer'
      AND replay_expires_at > redeemed_at
      AND replay_expires_at <= redeemed_at + 900000
    )
) WITHOUT ROWID;

CREATE INDEX identity_registration_token_redemption_account_idx
ON identity_registration_token_redemption(account_id, replay_expires_at DESC);

CREATE TABLE identity_registration_invitation (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (
      length(id) = 43
      AND id NOT GLOB '*[^A-Za-z0-9_-]*'
    ),
  team_id INTEGER NOT NULL
    REFERENCES team(id) ON DELETE CASCADE,
  invited_account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL COLLATE BINARY
    CHECK (relationship IN ('owner', 'manager')),
  inviter_account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL
    CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  expires_at INTEGER NOT NULL
    CHECK (
      typeof(expires_at) = 'integer'
      AND expires_at > created_at
      AND expires_at <= created_at + 2592000000
    ),
  accepted_at INTEGER
    CHECK (
      accepted_at IS NULL
      OR (
        typeof(accepted_at) = 'integer'
        AND accepted_at >= created_at
        AND accepted_at < expires_at
      )
    ),
  revoked_by_account_id TEXT COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  revoke_reason TEXT
    CHECK (
      revoke_reason IS NULL
      OR (length(revoke_reason) BETWEEN 1 AND 160 AND revoke_reason = trim(revoke_reason))
    ),
  revoked_at INTEGER
    CHECK (
      revoked_at IS NULL
      OR (typeof(revoked_at) = 'integer' AND revoked_at >= created_at)
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
  CHECK (invited_account_id != inviter_account_id),
  CHECK (
    (accepted_at IS NULL AND revoked_at IS NULL
      AND revoked_by_account_id IS NULL AND revoke_reason IS NULL)
    OR (accepted_at IS NOT NULL AND revoked_at IS NULL
      AND revoked_by_account_id IS NULL AND revoke_reason IS NULL)
    OR (accepted_at IS NULL AND revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
  )
);

CREATE UNIQUE INDEX identity_registration_invitation_target_idx
ON identity_registration_invitation(team_id, invited_account_id)
WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE UNIQUE INDEX identity_registration_invitation_transfer_idx
ON identity_registration_invitation(team_id)
WHERE relationship = 'owner' AND accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX identity_registration_invitation_inbox_idx
ON identity_registration_invitation(invited_account_id, created_at DESC)
WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX identity_registration_invitation_team_idx
ON identity_registration_invitation(team_id, created_at DESC);

CREATE UNIQUE INDEX identity_registration_invitation_write_nonce_idx
ON identity_registration_invitation(write_nonce)
WHERE write_nonce IS NOT NULL;

CREATE TRIGGER identity_registration_invitation_fresh_insert_guard
BEFORE INSERT ON identity_registration_invitation
WHEN NEW.accepted_at IS NOT NULL
  OR NEW.revoked_at IS NOT NULL
  OR NEW.revoked_by_account_id IS NOT NULL
  OR NEW.revoke_reason IS NOT NULL
  OR NEW.revision != 0
  OR NEW.write_nonce IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'registration invitation must start fresh');
END;

CREATE TRIGGER identity_registration_invitation_update_guard
BEFORE UPDATE ON identity_registration_invitation
WHEN NEW.id IS NOT OLD.id
  OR NEW.team_id IS NOT OLD.team_id
  OR NEW.invited_account_id IS NOT OLD.invited_account_id
  OR NEW.relationship IS NOT OLD.relationship
  OR NEW.inviter_account_id IS NOT OLD.inviter_account_id
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.revision != OLD.revision + 1
  OR NEW.write_nonce IS NULL
  OR NEW.write_nonce IS OLD.write_nonce
  OR OLD.accepted_at IS NOT NULL
  OR OLD.revoked_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'registration invitation revision conflict');
END;

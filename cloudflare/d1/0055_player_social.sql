CREATE TABLE account_bio (
  account_id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE CASCADE,
  bio TEXT NOT NULL CHECK (length(bio) BETWEEN 1 AND 120),
  updated_at INTEGER NOT NULL CHECK (typeof(updated_at) = 'integer' AND updated_at >= 0)
) WITHOUT ROWID;

CREATE TABLE player_follow (
  follower_account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE CASCADE,
  followed_account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  PRIMARY KEY (follower_account_id, followed_account_id),
  CHECK (follower_account_id != followed_account_id)
) WITHOUT ROWID;

CREATE INDEX player_follow_followed_idx ON player_follow(followed_account_id);

CREATE TRIGGER player_follow_guard
BEFORE INSERT ON player_follow
WHEN NOT EXISTS (
    SELECT 1 FROM identity_account
    WHERE id = NEW.followed_account_id AND status = 'active' AND public_handle IS NOT NULL
  )
  OR (SELECT COUNT(*) FROM player_follow WHERE follower_account_id = NEW.follower_account_id) >= 200
BEGIN
  SELECT RAISE(ABORT, 'player follow rejected');
END;

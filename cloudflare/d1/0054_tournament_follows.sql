CREATE TABLE tournament_follow (
  account_id TEXT NOT NULL COLLATE BINARY REFERENCES identity_account(id) ON DELETE CASCADE,
  tournament_id INTEGER NOT NULL REFERENCES tournament(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  PRIMARY KEY (account_id, tournament_id)
) WITHOUT ROWID;

CREATE TRIGGER tournament_follow_guard
BEFORE INSERT ON tournament_follow
WHEN NOT EXISTS (
    SELECT 1 FROM tournament WHERE id = NEW.tournament_id AND status != 'draft'
  )
  OR (SELECT COUNT(*) FROM tournament_follow WHERE account_id = NEW.account_id) >= 100
BEGIN
  SELECT RAISE(ABORT, 'tournament follow rejected');
END;

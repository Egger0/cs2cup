ALTER TABLE game ADD COLUMN loadout_codes INTEGER NOT NULL DEFAULT 0 CHECK (loadout_codes IN (0, 1));

UPDATE game SET loadout_codes = 1 WHERE lower(slug) = 'delta';

CREATE TABLE loadout_code (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL COLLATE BINARY REFERENCES identity_account(id) ON DELETE CASCADE,
  weapon TEXT NOT NULL CHECK (length(weapon) BETWEEN 1 AND 30),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 40),
  code TEXT NOT NULL CHECK (length(code) BETWEEN 4 AND 200),
  note TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 200),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  reviewed_at INTEGER CHECK (reviewed_at IS NULL OR typeof(reviewed_at) = 'integer'),
  reviewed_by_account_id TEXT COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE SET NULL,
  CHECK ((status = 'pending') = (reviewed_at IS NULL))
);

CREATE UNIQUE INDEX loadout_code_game_code_idx ON loadout_code(game_id, code);

CREATE INDEX loadout_code_review_idx ON loadout_code(status, created_at);

CREATE INDEX loadout_code_public_idx ON loadout_code(game_id, status, reviewed_at DESC);

CREATE TRIGGER loadout_code_submission_guard
BEFORE INSERT ON loadout_code
WHEN NEW.status != 'pending'
  OR NOT EXISTS (
    SELECT 1 FROM game WHERE id = NEW.game_id AND loadout_codes = 1 AND active = 1
  )
  OR (
    SELECT COUNT(*) FROM loadout_code WHERE account_id = NEW.account_id AND status = 'pending'
  ) >= 5
BEGIN
  SELECT RAISE(ABORT, 'loadout code submission rejected');
END;

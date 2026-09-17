ALTER TABLE loadout_code ADD COLUMN featured_at INTEGER
  CHECK (featured_at IS NULL OR typeof(featured_at) = 'integer');

CREATE INDEX loadout_code_featured_idx ON loadout_code(game_id, featured_at)
  WHERE featured_at IS NOT NULL;

CREATE TABLE loadout_favorite (
  code_id INTEGER NOT NULL REFERENCES loadout_code(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL COLLATE BINARY REFERENCES identity_account(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  PRIMARY KEY (code_id, account_id)
) WITHOUT ROWID;

CREATE INDEX loadout_favorite_account_idx ON loadout_favorite(account_id, created_at);

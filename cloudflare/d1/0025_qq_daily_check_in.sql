CREATE TABLE IF NOT EXISTS qq_account_link (
  account_id TEXT PRIMARY KEY REFERENCES identity_account(id) ON DELETE CASCADE,
  group_openid TEXT NOT NULL,
  member_openid TEXT NOT NULL UNIQUE,
  linked_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS qq_account_link_group_member_idx
ON qq_account_link(group_openid, member_openid);

CREATE TABLE IF NOT EXISTS qq_binding_code (
  code_hash TEXT PRIMARY KEY CHECK (length(code_hash) = 64),
  account_id TEXT NOT NULL UNIQUE REFERENCES identity_account(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS qq_binding_code_expiry_idx
ON qq_binding_code(expires_at);

CREATE TABLE IF NOT EXISTS qq_daily_check_in (
  account_id TEXT NOT NULL REFERENCES identity_account(id) ON DELETE CASCADE,
  check_in_date TEXT NOT NULL CHECK (check_in_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  signed_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, check_in_date)
);

CREATE INDEX IF NOT EXISTS qq_daily_check_in_date_idx
ON qq_daily_check_in(check_in_date, signed_at);

CREATE TABLE IF NOT EXISTS qq_check_in_streak (
  account_id TEXT PRIMARY KEY REFERENCES identity_account(id) ON DELETE CASCADE,
  current_streak INTEGER NOT NULL CHECK (current_streak > 0),
  last_check_in_date TEXT NOT NULL CHECK (last_check_in_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  last_signed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS qq_check_in_streak_rank_idx
ON qq_check_in_streak(last_check_in_date, current_streak DESC, last_signed_at ASC);

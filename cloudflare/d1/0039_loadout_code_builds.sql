DROP TRIGGER loadout_code_submission_guard;

DROP INDEX loadout_code_game_code_idx;

DROP INDEX loadout_code_review_idx;

DROP INDEX loadout_code_public_idx;

ALTER TABLE loadout_code RENAME TO loadout_code_legacy;

CREATE TABLE loadout_code (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL COLLATE BINARY REFERENCES identity_account(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('operations', 'warfare')),
  weapon TEXT NOT NULL CHECK (length(weapon) BETWEEN 1 AND 30),
  code TEXT NOT NULL COLLATE BINARY
    CHECK (length(code) = 21 AND code NOT GLOB '*[^0-9A-V]*'),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 40),
  note TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 200),
  tags TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(tags) AND json_type(tags) = 'array' AND json_array_length(tags) <= 3),
  price INTEGER CHECK (
    price IS NULL OR (mode = 'operations' AND typeof(price) = 'integer' AND price BETWEEN 1 AND 99999999)
  ),
  recoil INTEGER CHECK (recoil IS NULL OR recoil BETWEEN 0 AND 999),
  handling INTEGER CHECK (handling IS NULL OR handling BETWEEN 0 AND 999),
  stability INTEGER CHECK (stability IS NULL OR stability BETWEEN 0 AND 999),
  hipfire INTEGER CHECK (hipfire IS NULL OR hipfire BETWEEN 0 AND 999),
  distance INTEGER CHECK (distance IS NULL OR distance BETWEEN 0 AND 999),
  shot_key TEXT UNIQUE CHECK (shot_key IS NULL OR shot_key GLOB 'loadouts/*.webp'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  copies INTEGER NOT NULL DEFAULT 0 CHECK (copies >= 0),
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  reviewed_at INTEGER CHECK (reviewed_at IS NULL OR typeof(reviewed_at) = 'integer'),
  reviewed_by_account_id TEXT COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE SET NULL,
  CHECK ((status = 'pending') = (reviewed_at IS NULL)),
  CHECK (
    (recoil IS NULL) = (handling IS NULL) AND (handling IS NULL) = (stability IS NULL)
    AND (stability IS NULL) = (hipfire IS NULL) AND (hipfire IS NULL) = (distance IS NULL)
  )
);

INSERT OR IGNORE INTO loadout_code (
  id, game_id, account_id, mode, weapon, code, title, note, status,
  created_at, reviewed_at, reviewed_by_account_id
)
SELECT id, game_id, account_id, mode, CASE WHEN head BETWEEN 1 AND 30 THEN
    substr(trim(legacy.code), 1, head) ELSE weapon END,
  body, title, note, status, created_at, reviewed_at, reviewed_by_account_id
FROM (
  SELECT *,
    CASE WHEN code LIKE '%全面战场%' THEN 'warfare' ELSE 'operations' END AS mode,
    upper(substr(trim(code), -21)) AS body,
    max(instr(trim(code), '-烽火地带-'), instr(trim(code), '-全面战场-')) - 1 AS head
  FROM loadout_code_legacy
) AS legacy
WHERE length(body) = 21 AND body NOT GLOB '*[^0-9A-V]*';

DROP TABLE loadout_code_legacy;

CREATE UNIQUE INDEX loadout_code_game_code_idx ON loadout_code(game_id, code);

CREATE INDEX loadout_code_review_idx ON loadout_code(status, created_at);

CREATE INDEX loadout_code_public_idx ON loadout_code(game_id, status, mode);

CREATE INDEX loadout_code_author_idx ON loadout_code(account_id, status);

CREATE TABLE loadout_report (
  code_id INTEGER NOT NULL REFERENCES loadout_code(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL COLLATE BINARY REFERENCES identity_account(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  PRIMARY KEY (code_id, account_id)
) WITHOUT ROWID;

CREATE TRIGGER loadout_code_submission_guard
BEFORE INSERT ON loadout_code
WHEN NEW.status != 'pending' OR NEW.copies != 0
  OR NOT EXISTS (
    SELECT 1 FROM game WHERE id = NEW.game_id AND loadout_codes = 1 AND active = 1
  )
  OR (
    SELECT COUNT(*) FROM loadout_code WHERE account_id = NEW.account_id AND status = 'pending'
  ) >= 5
BEGIN
  SELECT RAISE(ABORT, 'loadout code submission rejected');
END;

CREATE TRIGGER loadout_report_guard
BEFORE INSERT ON loadout_report
WHEN NOT EXISTS (SELECT 1 FROM loadout_code WHERE id = NEW.code_id AND status = 'approved')
BEGIN
  SELECT RAISE(ABORT, 'loadout report rejected');
END;

CREATE TABLE loadout_like (
  code_id INTEGER NOT NULL REFERENCES loadout_code(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL COLLATE BINARY REFERENCES identity_account(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  PRIMARY KEY (code_id, account_id)
) WITHOUT ROWID;

CREATE TRIGGER loadout_like_guard
BEFORE INSERT ON loadout_like
WHEN NOT EXISTS (SELECT 1 FROM loadout_code WHERE id = NEW.code_id AND status = 'approved')
BEGIN
  SELECT RAISE(ABORT, 'loadout like rejected');
END;

CREATE TABLE loadout_comment (
  id INTEGER PRIMARY KEY,
  code_id INTEGER NOT NULL REFERENCES loadout_code(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL COLLATE BINARY REFERENCES identity_account(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 300),
  hidden_at INTEGER CHECK (hidden_at IS NULL OR typeof(hidden_at) = 'integer'),
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0)
);

CREATE INDEX loadout_comment_code_idx ON loadout_comment(code_id, created_at);

CREATE INDEX loadout_comment_author_idx ON loadout_comment(account_id, created_at);

CREATE TRIGGER loadout_comment_guard
BEFORE INSERT ON loadout_comment
WHEN NEW.hidden_at IS NOT NULL
  OR NOT EXISTS (
    SELECT 1 FROM loadout_code WHERE id = NEW.code_id AND status IN ('approved', 'expired')
  )
  OR (
    SELECT COUNT(*) FROM loadout_comment
    WHERE account_id = NEW.account_id AND created_at > NEW.created_at - 3600000
  ) >= 10
BEGIN
  SELECT RAISE(ABORT, 'loadout comment rejected');
END;

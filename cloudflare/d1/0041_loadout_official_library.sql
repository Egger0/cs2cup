DROP TRIGGER loadout_code_submission_guard;

DROP TRIGGER loadout_report_guard;

DROP TRIGGER loadout_like_guard;

DROP TRIGGER loadout_comment_guard;

CREATE TABLE loadout_report_backup AS SELECT * FROM loadout_report;

CREATE TABLE loadout_like_backup AS SELECT * FROM loadout_like;

CREATE TABLE loadout_comment_backup AS SELECT * FROM loadout_comment;

DROP INDEX loadout_code_game_code_idx;

DROP INDEX loadout_code_review_idx;

DROP INDEX loadout_code_public_idx;

DROP INDEX loadout_code_author_idx;

DROP INDEX loadout_code_pending_shot_idx;

CREATE TABLE loadout_code_next (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'member' CHECK (source IN ('member', 'official')),
  account_id TEXT COLLATE BINARY REFERENCES identity_account(id) ON DELETE CASCADE,
  official_id INTEGER UNIQUE,
  author_name TEXT CHECK (author_name IS NULL OR length(author_name) BETWEEN 1 AND 40),
  author_channel TEXT CHECK (author_channel IS NULL OR length(author_channel) BETWEEN 1 AND 20),
  mode TEXT NOT NULL CHECK (mode IN ('operations', 'warfare')),
  weapon TEXT NOT NULL CHECK (length(weapon) BETWEEN 1 AND 30),
  code TEXT NOT NULL COLLATE BINARY
    CHECK (length(code) = 21 AND code NOT GLOB '*[^0-9A-V]*'),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 40),
  note TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 200),
  tags TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(tags) AND json_type(tags) = 'array' AND json_array_length(tags) <= 6),
  price INTEGER CHECK (
    price IS NULL OR (typeof(price) = 'integer' AND price BETWEEN 1 AND 99999999)
  ),
  recoil INTEGER CHECK (recoil IS NULL OR recoil BETWEEN -999 AND 999),
  handling INTEGER CHECK (handling IS NULL OR handling BETWEEN -999 AND 999),
  stability INTEGER CHECK (stability IS NULL OR stability BETWEEN -999 AND 999),
  hipfire INTEGER CHECK (hipfire IS NULL OR hipfire BETWEEN -999 AND 999),
  distance INTEGER CHECK (distance IS NULL OR distance BETWEEN -999 AND 999),
  base_stats TEXT CHECK (base_stats IS NULL OR (json_valid(base_stats) AND json_type(base_stats) = 'object')),
  render_url TEXT CHECK (render_url IS NULL OR render_url GLOB 'https://playerhub.df.qq.com/*'),
  accessories TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(accessories) AND json_type(accessories) = 'array'),
  maps TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(maps) AND json_type(maps) = 'array'),
  apply_count INTEGER NOT NULL DEFAULT 0 CHECK (apply_count >= 0),
  official_likes INTEGER NOT NULL DEFAULT 0 CHECK (official_likes >= 0),
  shot_key TEXT UNIQUE CHECK (shot_key IS NULL OR shot_key GLOB 'loadouts/*.webp'),
  pending_shot_key TEXT
    CHECK (pending_shot_key IS NULL OR pending_shot_key GLOB 'loadouts/*.webp'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  copies INTEGER NOT NULL DEFAULT 0 CHECK (copies >= 0),
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  reviewed_at INTEGER CHECK (reviewed_at IS NULL OR typeof(reviewed_at) = 'integer'),
  reviewed_by_account_id TEXT COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE SET NULL,
  synced_at INTEGER CHECK (synced_at IS NULL OR typeof(synced_at) = 'integer'),
  CHECK ((status = 'pending') = (reviewed_at IS NULL)),
  CHECK (
    (recoil IS NULL) = (handling IS NULL) AND (handling IS NULL) = (stability IS NULL)
    AND (stability IS NULL) = (hipfire IS NULL) AND (hipfire IS NULL) = (distance IS NULL)
  ),
  CHECK (
    CASE source
      WHEN 'member' THEN account_id IS NOT NULL AND official_id IS NULL AND render_url IS NULL
        AND author_name IS NULL AND synced_at IS NULL
      ELSE account_id IS NULL AND official_id IS NOT NULL AND author_name IS NOT NULL
        AND synced_at IS NOT NULL AND status IN ('approved', 'expired')
    END
  )
);

INSERT INTO loadout_code_next (
  id, game_id, source, account_id, mode, weapon, code, title, note, tags, price,
  recoil, handling, stability, hipfire, distance, shot_key, pending_shot_key, status, copies,
  created_at, reviewed_at, reviewed_by_account_id
)
SELECT id, game_id, 'member', account_id, mode, weapon, code, title, note, tags, price,
  recoil, handling, stability, hipfire, distance, shot_key, pending_shot_key, status, copies,
  created_at, reviewed_at, reviewed_by_account_id
FROM loadout_code;

DROP TABLE loadout_code;

ALTER TABLE loadout_code_next RENAME TO loadout_code;

DELETE FROM loadout_report;

DELETE FROM loadout_like;

DELETE FROM loadout_comment;

INSERT INTO loadout_report SELECT * FROM loadout_report_backup;

INSERT INTO loadout_like SELECT * FROM loadout_like_backup;

INSERT INTO loadout_comment SELECT * FROM loadout_comment_backup;

DROP TABLE loadout_report_backup;

DROP TABLE loadout_like_backup;

DROP TABLE loadout_comment_backup;

CREATE UNIQUE INDEX loadout_code_game_code_idx ON loadout_code(game_id, code);

CREATE INDEX loadout_code_review_idx ON loadout_code(status, created_at);

CREATE INDEX loadout_code_public_idx ON loadout_code(game_id, status, mode, source);

CREATE INDEX loadout_code_author_idx ON loadout_code(account_id, status);

CREATE UNIQUE INDEX loadout_code_pending_shot_idx ON loadout_code(pending_shot_key)
  WHERE pending_shot_key IS NOT NULL;

CREATE TRIGGER loadout_code_submission_guard
BEFORE INSERT ON loadout_code
WHEN NEW.source = 'member' AND (
  NEW.status != 'pending' OR NEW.copies != 0
  OR NOT EXISTS (
    SELECT 1 FROM game WHERE id = NEW.game_id AND loadout_codes = 1 AND active = 1
  )
  OR (
    SELECT COUNT(*) FROM loadout_code WHERE account_id = NEW.account_id AND status = 'pending'
  ) >= 5
)
BEGIN
  SELECT RAISE(ABORT, 'loadout code submission rejected');
END;

CREATE TRIGGER loadout_report_guard
BEFORE INSERT ON loadout_report
WHEN NOT EXISTS (SELECT 1 FROM loadout_code WHERE id = NEW.code_id AND status = 'approved')
BEGIN
  SELECT RAISE(ABORT, 'loadout report rejected');
END;

CREATE TRIGGER loadout_like_guard
BEFORE INSERT ON loadout_like
WHEN NOT EXISTS (SELECT 1 FROM loadout_code WHERE id = NEW.code_id AND status = 'approved')
BEGIN
  SELECT RAISE(ABORT, 'loadout like rejected');
END;

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

CREATE TABLE loadout_weapon (
  object_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 30),
  category TEXT NOT NULL CHECK (length(category) BETWEEN 1 AND 20),
  image_url TEXT CHECK (image_url IS NULL OR image_url GLOB 'https://playerhub.df.qq.com/*'),
  stats TEXT NOT NULL CHECK (json_valid(stats) AND json_type(stats) = 'object'),
  synced_at INTEGER NOT NULL CHECK (typeof(synced_at) = 'integer')
);

CREATE TABLE loadout_accessory (
  object_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  slot TEXT NOT NULL CHECK (length(slot) BETWEEN 1 AND 20),
  grade INTEGER NOT NULL DEFAULT 0,
  image_url TEXT CHECK (image_url IS NULL OR image_url GLOB 'https://playerhub.df.qq.com/*'),
  price INTEGER,
  effects TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(effects) AND json_type(effects) = 'array'),
  synced_at INTEGER NOT NULL CHECK (typeof(synced_at) = 'integer')
);

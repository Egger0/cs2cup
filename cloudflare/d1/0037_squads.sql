ALTER TABLE game ADD COLUMN roster_size INTEGER NOT NULL DEFAULT 5 CHECK (roster_size BETWEEN 1 AND 5);

UPDATE game SET roster_size = 3 WHERE lower(slug) = 'delta';

CREATE TABLE squad (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (length(id) = 43 AND id NOT GLOB '*[^A-Za-z0-9_-]*'),
  game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 20),
  tag TEXT NOT NULL CHECK (length(tag) BETWEEN 2 AND 5 AND tag = upper(tag)),
  captain_account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  UNIQUE (game_id, name),
  UNIQUE (game_id, tag)
);

CREATE TABLE squad_member (
  squad_id TEXT NOT NULL COLLATE BINARY REFERENCES squad(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL COLLATE BINARY REFERENCES identity_account(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL CHECK (typeof(joined_at) = 'integer' AND joined_at >= 0),
  PRIMARY KEY (squad_id, account_id),
  UNIQUE (game_id, account_id)
);

CREATE TABLE squad_invitation (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (length(id) = 43 AND id NOT GLOB '*[^A-Za-z0-9_-]*'),
  squad_id TEXT NOT NULL COLLATE BINARY REFERENCES squad(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL COLLATE BINARY REFERENCES identity_account(id) ON DELETE CASCADE,
  invited_by_account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  responded_at INTEGER CHECK (responded_at IS NULL OR typeof(responded_at) = 'integer'),
  CHECK ((status = 'pending') = (responded_at IS NULL))
);

CREATE UNIQUE INDEX squad_invitation_pending_idx
ON squad_invitation(squad_id, account_id) WHERE status = 'pending';

CREATE INDEX squad_invitation_inbox_idx ON squad_invitation(account_id, status, created_at DESC);

CREATE TABLE squad_registration (
  squad_id TEXT NOT NULL COLLATE BINARY REFERENCES squad(id) ON DELETE CASCADE,
  tournament_id INTEGER NOT NULL REFERENCES tournament(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL UNIQUE REFERENCES team(id) ON DELETE CASCADE,
  registered_at INTEGER NOT NULL CHECK (typeof(registered_at) = 'integer' AND registered_at >= 0),
  PRIMARY KEY (squad_id, tournament_id)
);

CREATE TRIGGER squad_member_insert_guard
BEFORE INSERT ON squad_member
WHEN NOT EXISTS (SELECT 1 FROM squad WHERE id = NEW.squad_id AND game_id = NEW.game_id)
  OR (SELECT COUNT(*) FROM squad_member WHERE squad_id = NEW.squad_id)
    >= (SELECT roster_size FROM game WHERE id = NEW.game_id)
BEGIN
  SELECT RAISE(ABORT, 'squad is full');
END;

CREATE TRIGGER squad_captain_leave_guard
BEFORE DELETE ON squad_member
WHEN EXISTS (
  SELECT 1 FROM squad
  WHERE id = OLD.squad_id AND captain_account_id = OLD.account_id
)
BEGIN
  SELECT RAISE(ABORT, 'the captain disbands the squad instead of leaving');
END;

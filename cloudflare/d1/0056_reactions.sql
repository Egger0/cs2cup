CREATE TABLE comment_next (
  id INTEGER PRIMARY KEY,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('post', 'match', 'team')),
  subject_id INTEGER NOT NULL CHECK (typeof(subject_id) = 'integer' AND subject_id > 0),
  account_id TEXT NOT NULL COLLATE BINARY REFERENCES identity_account(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 300),
  hidden_at INTEGER CHECK (hidden_at IS NULL OR typeof(hidden_at) = 'integer'),
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0)
);

INSERT INTO comment_next (id, subject_kind, subject_id, account_id, body, hidden_at, created_at)
SELECT id, subject_kind, subject_id, account_id, body, hidden_at, created_at FROM comment;

DROP TRIGGER comment_post_cleanup;

DROP TRIGGER comment_match_cleanup;

DROP TABLE comment;

ALTER TABLE comment_next RENAME TO comment;

CREATE INDEX comment_subject_idx ON comment(subject_kind, subject_id, created_at);

CREATE INDEX comment_author_idx ON comment(account_id, created_at);

CREATE TRIGGER comment_guard
BEFORE INSERT ON comment
WHEN NEW.hidden_at IS NOT NULL
  OR (NEW.subject_kind = 'post' AND NOT EXISTS (SELECT 1 FROM post WHERE id = NEW.subject_id))
  OR (NEW.subject_kind = 'match' AND NOT EXISTS (
    SELECT 1 FROM match
    JOIN tournament ON tournament.id = match.tournament_id
    WHERE match.id = NEW.subject_id AND tournament.status != 'draft'
  ))
  OR (NEW.subject_kind = 'team' AND NOT EXISTS (
    SELECT 1 FROM team
    JOIN tournament ON tournament.id = team.tournament_id
    WHERE team.id = NEW.subject_id AND team.status = 'approved' AND tournament.status != 'draft'
  ))
  OR (
    SELECT COUNT(*) FROM comment
    WHERE account_id = NEW.account_id AND created_at > NEW.created_at - 3600000
  ) >= 10
BEGIN
  SELECT RAISE(ABORT, 'comment rejected');
END;

CREATE TRIGGER comment_post_cleanup
AFTER DELETE ON post
BEGIN
  DELETE FROM comment WHERE subject_kind = 'post' AND subject_id = OLD.id;
END;

CREATE TRIGGER comment_match_cleanup
AFTER DELETE ON match
BEGIN
  DELETE FROM comment WHERE subject_kind = 'match' AND subject_id = OLD.id;
END;

CREATE TRIGGER comment_team_cleanup
AFTER DELETE ON team
BEGIN
  DELETE FROM comment WHERE subject_kind = 'team' AND subject_id = OLD.id;
END;

CREATE TABLE reaction (
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('post', 'match', 'team', 'comment')),
  subject_id INTEGER NOT NULL CHECK (typeof(subject_id) = 'integer' AND subject_id > 0),
  account_id TEXT NOT NULL COLLATE BINARY REFERENCES identity_account(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL CHECK (emoji IN ('fire', 'like', 'clap', 'heart', 'laugh')),
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  PRIMARY KEY (subject_kind, subject_id, account_id)
) WITHOUT ROWID;

CREATE INDEX reaction_account_idx ON reaction(account_id, created_at);

CREATE TRIGGER reaction_guard
BEFORE INSERT ON reaction
WHEN (NEW.subject_kind = 'post' AND NOT EXISTS (SELECT 1 FROM post WHERE id = NEW.subject_id))
  OR (NEW.subject_kind = 'match' AND NOT EXISTS (
    SELECT 1 FROM match
    JOIN tournament ON tournament.id = match.tournament_id
    WHERE match.id = NEW.subject_id AND tournament.status != 'draft'
  ))
  OR (NEW.subject_kind = 'team' AND NOT EXISTS (
    SELECT 1 FROM team
    JOIN tournament ON tournament.id = team.tournament_id
    WHERE team.id = NEW.subject_id AND team.status = 'approved' AND tournament.status != 'draft'
  ))
  OR (NEW.subject_kind = 'comment' AND NOT EXISTS (
    SELECT 1 FROM comment WHERE id = NEW.subject_id AND hidden_at IS NULL
  ))
BEGIN
  SELECT RAISE(ABORT, 'reaction rejected');
END;

CREATE TRIGGER reaction_post_cleanup
AFTER DELETE ON post
BEGIN
  DELETE FROM reaction WHERE subject_kind = 'post' AND subject_id = OLD.id;
END;

CREATE TRIGGER reaction_match_cleanup
AFTER DELETE ON match
BEGIN
  DELETE FROM reaction WHERE subject_kind = 'match' AND subject_id = OLD.id;
END;

CREATE TRIGGER reaction_team_cleanup
AFTER DELETE ON team
BEGIN
  DELETE FROM reaction WHERE subject_kind = 'team' AND subject_id = OLD.id;
END;

CREATE TRIGGER reaction_comment_cleanup
AFTER DELETE ON comment
BEGIN
  DELETE FROM reaction WHERE subject_kind = 'comment' AND subject_id = OLD.id;
END;

CREATE TRIGGER reaction_comment_hidden
AFTER UPDATE OF hidden_at ON comment
WHEN NEW.hidden_at IS NOT NULL
BEGIN
  DELETE FROM reaction WHERE subject_kind = 'comment' AND subject_id = NEW.id;
END;

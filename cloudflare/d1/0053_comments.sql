CREATE TABLE comment (
  id INTEGER PRIMARY KEY,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('post', 'match')),
  subject_id INTEGER NOT NULL CHECK (typeof(subject_id) = 'integer' AND subject_id > 0),
  account_id TEXT NOT NULL COLLATE BINARY REFERENCES identity_account(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 300),
  hidden_at INTEGER CHECK (hidden_at IS NULL OR typeof(hidden_at) = 'integer'),
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0)
);

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

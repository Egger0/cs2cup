CREATE TABLE guestbook_message (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 32),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'hidden')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE guestbook_attempt (
  id INTEGER PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX guestbook_message_status_created_idx
  ON guestbook_message(status, created_at DESC);
CREATE INDEX guestbook_attempt_window_idx
  ON guestbook_attempt(fingerprint, created_at DESC);

CREATE TRIGGER guestbook_attempt_limit_before_insert
BEFORE INSERT ON guestbook_attempt
WHEN (
  SELECT COUNT(*)
  FROM guestbook_attempt
  WHERE fingerprint = NEW.fingerprint
    AND created_at > datetime('now', '-1 hour')
) >= 5
BEGIN
  SELECT RAISE(ABORT, '留言太频繁');
END;

CREATE VIEW guestbook_public AS
SELECT id, name, body, created_at
FROM guestbook_message
WHERE status = 'published';

ALTER TABLE guestbook_message
ADD COLUMN parent_id INTEGER REFERENCES guestbook_message(id) ON DELETE CASCADE;

ALTER TABLE guestbook_message
ADD COLUMN is_official INTEGER NOT NULL DEFAULT 0 CHECK (is_official IN (0, 1));

CREATE INDEX guestbook_message_parent_created_idx
ON guestbook_message(parent_id, created_at ASC);

DROP VIEW guestbook_public;
CREATE VIEW guestbook_public AS
SELECT id, name, body, parent_id, is_official, created_at
FROM guestbook_message
WHERE status = 'published';

CREATE TRIGGER guestbook_reply_parent_before_insert
BEFORE INSERT ON guestbook_message
WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM guestbook_message
  WHERE id = NEW.parent_id
    AND parent_id IS NULL
    AND status = 'published'
)
BEGIN
  SELECT RAISE(ABORT, '只能回复已公开留言');
END;

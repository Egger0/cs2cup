ALTER TABLE guestbook_message
ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1));

CREATE INDEX guestbook_message_public_order_idx
ON guestbook_message(status, pinned DESC, created_at DESC);

DROP VIEW guestbook_public;
CREATE VIEW guestbook_public AS
SELECT id, name, body, parent_id, is_official, pinned, created_at
FROM guestbook_message
WHERE status = 'published';

CREATE TRIGGER guestbook_pin_root_before_insert
BEFORE INSERT ON guestbook_message
WHEN NEW.pinned = 1 AND NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, '只能置顶主留言');
END;

CREATE TRIGGER guestbook_pin_root_before_update
BEFORE UPDATE OF pinned ON guestbook_message
WHEN NEW.pinned = 1 AND NEW.parent_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, '只能置顶主留言');
END;

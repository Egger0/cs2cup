CREATE TABLE notification (
  id INTEGER PRIMARY KEY,
  account_id TEXT NOT NULL COLLATE BINARY REFERENCES identity_account(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('squad_invitation', 'loadout_comment', 'loadout_review')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 200),
  href TEXT NOT NULL CHECK (href GLOB '/*' AND href NOT GLOB '//*'),
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  read_at INTEGER CHECK (read_at IS NULL OR typeof(read_at) = 'integer')
);

CREATE INDEX notification_inbox_idx ON notification(account_id, created_at DESC);

CREATE INDEX notification_unread_idx ON notification(account_id) WHERE read_at IS NULL;

CREATE TRIGGER notification_squad_invitation
AFTER INSERT ON squad_invitation
BEGIN
  INSERT INTO notification (account_id, kind, title, body, href, created_at)
  SELECT NEW.account_id, 'squad_invitation', '收到小队邀请',
         inviter.display_name || ' 邀请你加入「' || squad.name || '」', '/squads', NEW.created_at
  FROM squad
  JOIN identity_account AS inviter ON inviter.id = NEW.invited_by_account_id
  WHERE squad.id = NEW.squad_id;
END;

CREATE TRIGGER notification_loadout_comment
AFTER INSERT ON loadout_comment
BEGIN
  INSERT INTO notification (account_id, kind, title, body, href, created_at)
  SELECT code.account_id, 'loadout_comment', '你的改枪码有了新留言',
         commenter.display_name || ' 评论了「' || code.title || '」',
         '/games/' || game.slug || '/loadouts/' || code.id, NEW.created_at
  FROM loadout_code AS code
  JOIN game ON game.id = code.game_id
  JOIN identity_account AS commenter ON commenter.id = NEW.account_id
  WHERE code.id = NEW.code_id AND code.account_id IS NOT NULL
    AND code.account_id != NEW.account_id;
END;

CREATE TRIGGER notification_loadout_review
AFTER UPDATE OF status ON loadout_code
WHEN OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') AND NEW.account_id IS NOT NULL
BEGIN
  INSERT INTO notification (account_id, kind, title, body, href, created_at)
  VALUES (
    NEW.account_id, 'loadout_review',
    CASE NEW.status WHEN 'approved' THEN '改枪码已通过审核' ELSE '改枪码未通过审核' END,
    '「' || NEW.title || '」', '/me', COALESCE(NEW.reviewed_at, 0)
  );
END;

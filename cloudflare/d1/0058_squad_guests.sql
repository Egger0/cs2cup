CREATE TABLE squad_guest (
  id INTEGER PRIMARY KEY,
  squad_id TEXT NOT NULL COLLATE BINARY REFERENCES squad(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL CHECK (length(nickname) BETWEEN 1 AND 20),
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  UNIQUE (squad_id, nickname)
);

DROP TRIGGER squad_member_insert_guard;

CREATE TRIGGER squad_member_insert_guard
BEFORE INSERT ON squad_member
WHEN NOT EXISTS (SELECT 1 FROM squad WHERE id = NEW.squad_id AND game_id = NEW.game_id)
  OR (SELECT COUNT(*) FROM squad_member WHERE squad_id = NEW.squad_id)
    + (SELECT COUNT(*) FROM squad_guest WHERE squad_id = NEW.squad_id)
    >= (SELECT roster_size FROM game WHERE id = NEW.game_id)
BEGIN
  SELECT RAISE(ABORT, 'squad is full');
END;

CREATE TRIGGER squad_guest_insert_guard
BEFORE INSERT ON squad_guest
WHEN (SELECT COUNT(*) FROM squad_member WHERE squad_id = NEW.squad_id)
    + (SELECT COUNT(*) FROM squad_guest WHERE squad_id = NEW.squad_id)
    >= (SELECT game.roster_size FROM squad JOIN game ON game.id = squad.game_id
        WHERE squad.id = NEW.squad_id)
BEGIN
  SELECT RAISE(ABORT, 'squad is full');
END;

DROP TRIGGER notification_squad_invitation;

CREATE TRIGGER notification_squad_invitation
AFTER INSERT ON squad_invitation
BEGIN
  INSERT INTO notification (account_id, kind, title, body, href, created_at)
  SELECT NEW.account_id, 'squad_invitation', '收到战队邀请',
         inviter.display_name || ' 邀请你加入「' || squad.name || '」', '/squads', NEW.created_at
  FROM squad
  JOIN identity_account AS inviter ON inviter.id = NEW.invited_by_account_id
  WHERE squad.id = NEW.squad_id;
END;

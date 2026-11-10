CREATE TABLE team_follow (
  account_id TEXT NOT NULL COLLATE BINARY REFERENCES identity_account(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  PRIMARY KEY (account_id, team_id)
) WITHOUT ROWID;

CREATE INDEX team_follow_team_idx ON team_follow(team_id);

CREATE TRIGGER team_follow_guard
BEFORE INSERT ON team_follow
WHEN NOT EXISTS (
    SELECT 1 FROM team
    JOIN tournament ON tournament.id = team.tournament_id
    WHERE team.id = NEW.team_id AND team.status = 'approved' AND tournament.status != 'draft'
  )
  OR (SELECT COUNT(*) FROM team_follow WHERE account_id = NEW.account_id) >= 200
BEGIN
  SELECT RAISE(ABORT, 'team follow rejected');
END;

DROP TRIGGER notification_squad_invitation;

DROP TRIGGER notification_loadout_comment;

DROP TRIGGER notification_loadout_review;

CREATE TABLE notification_next (
  id INTEGER PRIMARY KEY,
  account_id TEXT NOT NULL COLLATE BINARY REFERENCES identity_account(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN (
    'squad_invitation', 'loadout_comment', 'loadout_review', 'team_result', 'comment_reply'
  )),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 200),
  href TEXT NOT NULL CHECK (href GLOB '/*' AND href NOT GLOB '//*'),
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0),
  read_at INTEGER CHECK (read_at IS NULL OR typeof(read_at) = 'integer')
);

INSERT INTO notification_next (id, account_id, kind, title, body, href, created_at, read_at)
SELECT id, account_id, kind, title, body, href, created_at, read_at FROM notification;

DROP TABLE notification;

ALTER TABLE notification_next RENAME TO notification;

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

CREATE TRIGGER notification_team_result
AFTER UPDATE OF winner_team_id ON match
WHEN OLD.winner_team_id IS NULL AND NEW.winner_team_id IS NOT NULL
  AND NEW.team_a_id IS NOT NULL AND NEW.team_b_id IS NOT NULL
BEGIN
  INSERT INTO notification (account_id, kind, title, body, href, created_at)
  SELECT DISTINCT follow.account_id, 'team_result', '关注的队伍有了赛果',
         a.name || ' ' || COALESCE(NEW.score_a, 0) || ' : ' || COALESCE(NEW.score_b, 0) || ' ' || b.name
           || ' · ' || NEW.round_label,
         '/tournaments/' || tournament.slug || '/matches/' || NEW.id,
         unixepoch() * 1000
  FROM team_follow AS follow
  JOIN team AS a ON a.id = NEW.team_a_id
  JOIN team AS b ON b.id = NEW.team_b_id
  JOIN tournament ON tournament.id = NEW.tournament_id
  WHERE follow.team_id IN (NEW.team_a_id, NEW.team_b_id);
END;

CREATE TRIGGER notification_comment_reply
AFTER INSERT ON comment
BEGIN
  INSERT INTO notification (account_id, kind, title, body, href, created_at)
  SELECT DISTINCT earlier.account_id, 'comment_reply', '你参与的讨论有了新留言',
         substr(author.display_name || '：' || NEW.body, 1, 200),
         CASE NEW.subject_kind
           WHEN 'post' THEN (SELECT '/news/' || slug FROM post WHERE id = NEW.subject_id)
           WHEN 'match' THEN (
             SELECT '/tournaments/' || tournament.slug || '/matches/' || match.id
             FROM match JOIN tournament ON tournament.id = match.tournament_id
             WHERE match.id = NEW.subject_id
           )
           ELSE (
             SELECT '/tournaments/' || tournament.slug || '/teams/' || team.tag
             FROM team JOIN tournament ON tournament.id = team.tournament_id
             WHERE team.id = NEW.subject_id
           )
         END,
         NEW.created_at
  FROM comment AS earlier
  JOIN identity_account AS author ON author.id = NEW.account_id
  WHERE earlier.subject_kind = NEW.subject_kind AND earlier.subject_id = NEW.subject_id
    AND earlier.account_id != NEW.account_id AND earlier.hidden_at IS NULL
    AND earlier.created_at > NEW.created_at - 604800000;
END;

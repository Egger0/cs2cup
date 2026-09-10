CREATE TABLE recruitment_lottery_campaign (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY,
  title TEXT NOT NULL COLLATE BINARY,
  starts_at INTEGER NOT NULL CHECK (typeof(starts_at) = 'integer' AND starts_at >= 0),
  ends_at INTEGER NOT NULL CHECK (typeof(ends_at) = 'integer' AND ends_at > starts_at)
);

CREATE TABLE recruitment_lottery_prize (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY,
  campaign_id TEXT NOT NULL COLLATE BINARY
    REFERENCES recruitment_lottery_campaign(id) ON DELETE CASCADE,
  title TEXT NOT NULL COLLATE BINARY,
  quantity INTEGER NOT NULL CHECK (typeof(quantity) = 'integer' AND quantity > 0),
  requires_claim INTEGER NOT NULL DEFAULT 1 CHECK (requires_claim IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (typeof(sort_order) = 'integer' AND sort_order >= 0),
  UNIQUE (campaign_id, title)
);

CREATE TABLE recruitment_lottery_ticket (
  id INTEGER PRIMARY KEY,
  campaign_id TEXT NOT NULL COLLATE BINARY
    REFERENCES recruitment_lottery_campaign(id) ON DELETE CASCADE,
  prize_id TEXT NOT NULL COLLATE BINARY
    REFERENCES recruitment_lottery_prize(id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (typeof(ordinal) = 'integer' AND ordinal > 0),
  UNIQUE (campaign_id, ordinal)
);

CREATE INDEX recruitment_lottery_ticket_campaign_prize_idx
ON recruitment_lottery_ticket(campaign_id, prize_id);

CREATE TABLE recruitment_lottery_draw (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (length(id) = 43 AND id NOT GLOB '*[^A-Za-z0-9_-]*'),
  campaign_id TEXT NOT NULL COLLATE BINARY
    REFERENCES recruitment_lottery_campaign(id) ON DELETE RESTRICT,
  account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  ticket_id INTEGER NOT NULL UNIQUE
    REFERENCES recruitment_lottery_ticket(id) ON DELETE RESTRICT,
  receipt_code TEXT UNIQUE COLLATE BINARY
    CHECK (receipt_code IS NULL OR (length(receipt_code) = 10 AND receipt_code NOT GLOB '*[^A-Z0-9]*')),
  drawn_at INTEGER NOT NULL CHECK (typeof(drawn_at) = 'integer' AND drawn_at >= 0),
  claimed_at INTEGER CHECK (claimed_at IS NULL OR (typeof(claimed_at) = 'integer' AND claimed_at >= drawn_at)),
  claimed_by_account_id TEXT COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE RESTRICT,
  UNIQUE (campaign_id, account_id),
  CHECK ((claimed_at IS NULL AND claimed_by_account_id IS NULL) OR (claimed_at IS NOT NULL AND claimed_by_account_id IS NOT NULL))
);

CREATE INDEX recruitment_lottery_draw_campaign_account_idx
ON recruitment_lottery_draw(campaign_id, account_id);

CREATE TRIGGER recruitment_lottery_draw_ticket_guard
BEFORE INSERT ON recruitment_lottery_draw
WHEN NOT EXISTS (
  SELECT 1
  FROM recruitment_lottery_ticket AS ticket
  JOIN recruitment_lottery_prize AS prize ON prize.id = ticket.prize_id
  WHERE ticket.id = NEW.ticket_id
    AND ticket.campaign_id = NEW.campaign_id
    AND prize.campaign_id = NEW.campaign_id
    AND ((prize.requires_claim = 1 AND NEW.receipt_code IS NOT NULL) OR (prize.requires_claim = 0 AND NEW.receipt_code IS NULL))
)
BEGIN
  SELECT RAISE(ABORT, 'lottery ticket and receipt must match the campaign prize');
END;

CREATE TRIGGER recruitment_lottery_draw_claim_guard
BEFORE UPDATE ON recruitment_lottery_draw
WHEN NEW.id IS NOT OLD.id
  OR NEW.campaign_id IS NOT OLD.campaign_id
  OR NEW.account_id IS NOT OLD.account_id
  OR NEW.ticket_id IS NOT OLD.ticket_id
  OR NEW.receipt_code IS NOT OLD.receipt_code
  OR NEW.drawn_at IS NOT OLD.drawn_at
  OR OLD.claimed_at IS NOT NULL
  OR NEW.claimed_at IS NULL
  OR NEW.claimed_by_account_id IS NULL
  OR NOT EXISTS (
    SELECT 1
    FROM recruitment_lottery_ticket AS ticket
    JOIN recruitment_lottery_prize AS prize ON prize.id = ticket.prize_id
    WHERE ticket.id = OLD.ticket_id AND prize.requires_claim = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'lottery draw can only be claimed once for a physical prize');
END;

INSERT INTO recruitment_lottery_campaign (id, title, starts_at, ends_at)
VALUES ('recruitment-2026-09-20', '2026 百团大战社团招新抽奖', 1789833600000, 1789920000000);

INSERT INTO recruitment_lottery_prize (id, campaign_id, title, quantity, requires_claim, sort_order)
VALUES
  ('recruitment-2026-missing-link-plush', 'recruitment-2026-09-20', 'CS-Missing Link毛绒挂件', 14, 1, 1),
  ('recruitment-2026-major-postcard', 'recruitment-2026-09-20', 'CS-Major主题明信片', 30, 1, 2),
  ('recruitment-2026-molotov-charm', 'recruitment-2026-09-20', 'CS-2024-燃烧瓶发声挂件', 1, 1, 3),
  ('recruitment-2026-grenade-charm', 'recruitment-2026-09-20', 'CS-2024-手雷发声挂件', 1, 1, 4),
  ('recruitment-2026-weapon-pin-box', 'recruitment-2026-09-20', 'CS-武器徽章盲盒(枪)', 12, 1, 5),
  ('recruitment-2026-go-classmate-charm', 'recruitment-2026-09-20', 'CS-GO同学挂件', 4, 1, 6),
  ('recruitment-2026-thanks', 'recruitment-2026-09-20', '谢谢参与', 58, 0, 7);

WITH RECURSIVE sequence(ordinal) AS (
  VALUES (1)
  UNION ALL
  SELECT ordinal + 1 FROM sequence WHERE ordinal < 120
)
INSERT INTO recruitment_lottery_ticket (campaign_id, prize_id, ordinal)
SELECT
  'recruitment-2026-09-20',
  CASE
    WHEN ordinal <= 14 THEN 'recruitment-2026-missing-link-plush'
    WHEN ordinal <= 44 THEN 'recruitment-2026-major-postcard'
    WHEN ordinal = 45 THEN 'recruitment-2026-molotov-charm'
    WHEN ordinal = 46 THEN 'recruitment-2026-grenade-charm'
    WHEN ordinal <= 58 THEN 'recruitment-2026-weapon-pin-box'
    WHEN ordinal <= 62 THEN 'recruitment-2026-go-classmate-charm'
    ELSE 'recruitment-2026-thanks'
  END,
  ordinal
FROM sequence;

CREATE TABLE nbt_grant (
  account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('check_in', 'matchday')),
  grant_date TEXT NOT NULL
    CHECK (grant_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  amount INTEGER NOT NULL CHECK (typeof(amount) = 'integer' AND amount > 0),
  granted_at INTEGER NOT NULL CHECK (typeof(granted_at) = 'integer' AND granted_at >= 0),
  PRIMARY KEY (account_id, kind, grant_date)
);

CREATE TABLE match_prediction (
  match_id INTEGER NOT NULL REFERENCES match(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL COLLATE BINARY
    REFERENCES identity_account(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  stake INTEGER NOT NULL CHECK (typeof(stake) = 'integer' AND stake BETWEEN 1 AND 1000),
  placed_at INTEGER NOT NULL CHECK (typeof(placed_at) = 'integer' AND placed_at >= 0),
  PRIMARY KEY (match_id, account_id)
);

CREATE INDEX match_prediction_account_idx ON match_prediction(account_id, placed_at DESC);

CREATE VIEW match_prediction_pool AS
SELECT
  m.id AS match_id,
  m.team_a_id,
  m.team_b_id,
  m.winner_team_id,
  COALESCE(SUM(CASE WHEN p.team_id = m.team_a_id THEN p.stake END), 0) AS stake_a,
  COALESCE(SUM(CASE WHEN p.team_id = m.team_b_id THEN p.stake END), 0) AS stake_b,
  COUNT(CASE WHEN p.team_id = m.team_a_id THEN 1 END) AS backers_a,
  COUNT(CASE WHEN p.team_id = m.team_b_id THEN 1 END) AS backers_b
FROM match AS m
LEFT JOIN match_prediction AS p ON p.match_id = m.id
GROUP BY m.id;

CREATE VIEW match_prediction_outcome AS
SELECT
  p.match_id,
  p.account_id,
  p.team_id,
  p.stake,
  p.placed_at,
  CASE
    WHEN p.team_id IS NOT pool.team_a_id AND p.team_id IS NOT pool.team_b_id THEN 'void'
    WHEN pool.winner_team_id IS NULL THEN 'open'
    WHEN pool.winner_team_id IS NOT pool.team_a_id AND pool.winner_team_id IS NOT pool.team_b_id
      THEN 'void'
    WHEN (CASE WHEN pool.winner_team_id = pool.team_a_id THEN pool.stake_a ELSE pool.stake_b END) = 0
      THEN 'void'
    WHEN p.team_id = pool.winner_team_id THEN 'won'
    ELSE 'lost'
  END AS status,
  CASE
    WHEN p.team_id IS NOT pool.team_a_id AND p.team_id IS NOT pool.team_b_id THEN 0
    WHEN pool.winner_team_id IS NULL THEN -p.stake
    WHEN pool.winner_team_id IS NOT pool.team_a_id AND pool.winner_team_id IS NOT pool.team_b_id
      THEN 0
    WHEN (CASE WHEN pool.winner_team_id = pool.team_a_id THEN pool.stake_a ELSE pool.stake_b END) = 0
      THEN 0
    WHEN p.team_id = pool.winner_team_id THEN
      (p.stake * (pool.stake_a + pool.stake_b))
        / (CASE WHEN pool.winner_team_id = pool.team_a_id THEN pool.stake_a ELSE pool.stake_b END)
        - p.stake
    ELSE -p.stake
  END AS delta
FROM match_prediction AS p
JOIN match_prediction_pool AS pool ON pool.match_id = p.match_id;

CREATE VIEW nbt_balance AS
SELECT account_id, SUM(amount) AS balance
FROM (
  SELECT account_id, amount FROM nbt_grant
  UNION ALL
  SELECT account_id, delta AS amount FROM match_prediction_outcome
)
GROUP BY account_id;

CREATE TRIGGER match_prediction_insert_guard
BEFORE INSERT ON match_prediction
WHEN NOT EXISTS (
    SELECT 1
    FROM match AS m
    JOIN tournament AS t ON t.id = m.tournament_id
    JOIN identity_membership AS membership
      ON membership.account_id = NEW.account_id
     AND membership.status = 'approved' AND membership.revoked_at IS NULL
    WHERE m.id = NEW.match_id
      AND t.status IN ('registration', 'running', 'postponed')
      AND m.winner_team_id IS NULL
      AND m.team_a_id IS NOT NULL AND m.team_b_id IS NOT NULL
      AND NEW.team_id IN (m.team_a_id, m.team_b_id)
      AND m.scheduled_at IS NOT NULL
      AND unixepoch(m.scheduled_at) * 1000 > NEW.placed_at
  )
  OR COALESCE((SELECT balance FROM nbt_balance WHERE account_id = NEW.account_id), 0) < NEW.stake
BEGIN
  SELECT RAISE(ABORT, 'match prediction rejected');
END;

CREATE TRIGGER match_prediction_update_guard
BEFORE UPDATE ON match_prediction
BEGIN
  SELECT RAISE(ABORT, 'match predictions are final');
END;

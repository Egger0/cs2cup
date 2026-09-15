DROP TRIGGER match_prediction_insert_guard;

DROP VIEW nbt_balance;

ALTER TABLE nbt_grant RENAME TO stardust_grant;

CREATE VIEW stardust_balance AS
SELECT account_id, SUM(amount) AS balance
FROM (
  SELECT account_id, amount FROM stardust_grant
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
  OR COALESCE((SELECT balance FROM stardust_balance WHERE account_id = NEW.account_id), 0) < NEW.stake
BEGIN
  SELECT RAISE(ABORT, 'match prediction rejected');
END;

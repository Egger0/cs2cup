DROP VIEW match_prediction_outcome;

CREATE VIEW match_prediction_outcome AS
WITH graded AS (
  SELECT
    p.match_id,
    p.account_id,
    p.team_id,
    p.stake,
    p.placed_at,
    pool.stake_a + pool.stake_b AS pot,
    CASE WHEN pool.winner_team_id = pool.team_a_id THEN pool.stake_a ELSE pool.stake_b END
      AS winning_stake,
    CASE
      WHEN p.team_id IS NOT pool.team_a_id AND p.team_id IS NOT pool.team_b_id THEN 'void'
      WHEN pool.winner_team_id IS NULL THEN 'open'
      WHEN pool.winner_team_id IS NOT pool.team_a_id AND pool.winner_team_id IS NOT pool.team_b_id
        THEN 'void'
      WHEN (CASE WHEN pool.winner_team_id = pool.team_a_id THEN pool.stake_a ELSE pool.stake_b END) = 0
        THEN 'void'
      WHEN p.team_id = pool.winner_team_id THEN 'won'
      ELSE 'lost'
    END AS status
  FROM match_prediction AS p
  JOIN match_prediction_pool AS pool ON pool.match_id = p.match_id
),
won AS (
  SELECT
    match_id,
    account_id,
    team_id,
    stake,
    placed_at,
    status,
    (stake * pot) / winning_stake AS floor_share,
    ROW_NUMBER() OVER (
      PARTITION BY match_id
      ORDER BY (stake * pot) % winning_stake DESC, account_id
    ) AS remainder_rank,
    pot - SUM((stake * pot) / winning_stake) OVER (PARTITION BY match_id) AS leftover
  FROM graded
  WHERE status = 'won'
)
SELECT match_id, account_id, team_id, stake, placed_at, status,
       CASE WHEN status = 'void' THEN 0 ELSE -stake END AS delta
FROM graded
WHERE status <> 'won'
UNION ALL
SELECT match_id, account_id, team_id, stake, placed_at, status,
       floor_share + (CASE WHEN remainder_rank <= leftover THEN 1 ELSE 0 END) - stake AS delta
FROM won;

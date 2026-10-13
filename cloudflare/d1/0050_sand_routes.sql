CREATE TABLE sand_route (
  id INTEGER PRIMARY KEY,
  account_id TEXT NOT NULL COLLATE BINARY REFERENCES identity_account(id) ON DELETE CASCADE,
  map_id TEXT NOT NULL CHECK (length(map_id) BETWEEN 1 AND 40),
  level INTEGER NOT NULL CHECK (level BETWEEN 0 AND 9),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 40 AND title = trim(title)),
  waypoints TEXT NOT NULL
    CHECK (json_valid(waypoints) AND json_array_length(waypoints) BETWEEN 2 AND 40),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  created_at INTEGER NOT NULL CHECK (typeof(created_at) = 'integer' AND created_at >= 0)
);

CREATE INDEX sand_route_public_idx ON sand_route (status, map_id, created_at);

CREATE TRIGGER sand_route_submission_guard
BEFORE INSERT ON sand_route
WHEN NEW.status != 'pending'
  OR (
    SELECT COUNT(*) FROM sand_route WHERE account_id = NEW.account_id AND status = 'pending'
  ) >= 5
BEGIN
  SELECT RAISE(ABORT, 'sand route submission rejected');
END;

CREATE TABLE IF NOT EXISTS qq_bot_delivery_log (
  delivery_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('welcome', 'morning')),
  group_openid TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS qq_bot_delivery_log_created_idx
ON qq_bot_delivery_log(created_at);

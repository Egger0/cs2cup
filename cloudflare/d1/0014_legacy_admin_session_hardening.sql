CREATE TABLE admin_session_hardened (
  token_hash TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    CHECK (
      length(token_hash) = 64
      AND token_hash NOT GLOB '*[^0-9a-f]*'
    ),
  admin_id INTEGER NOT NULL
    REFERENCES admin_account(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
    CHECK (typeof(expires_at) = 'integer' AND expires_at >= 0)
);

INSERT OR IGNORE INTO admin_session_hardened (token_hash, admin_id, expires_at)
SELECT token_hash, admin_id, expires_at
FROM admin_session
WHERE token_hash IS NOT NULL
  AND length(token_hash) = 64
  AND token_hash NOT GLOB '*[^0-9a-f]*'
  AND typeof(expires_at) = 'integer'
  AND expires_at >= 0;

DROP TABLE admin_session;

ALTER TABLE admin_session_hardened RENAME TO admin_session;

CREATE INDEX admin_session_expires_at_idx ON admin_session(expires_at);

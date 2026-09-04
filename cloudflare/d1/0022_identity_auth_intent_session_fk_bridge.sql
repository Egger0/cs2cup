CREATE TABLE identity_session_before_password (
  id TEXT PRIMARY KEY NOT NULL COLLATE BINARY
    REFERENCES identity_session(id) ON DELETE CASCADE
    CHECK (length(id) = 43 AND id NOT GLOB '*[^A-Za-z0-9_-]*')
);

INSERT INTO identity_session_before_password (id)
SELECT DISTINCT initiating_session_id
FROM identity_auth_intent
WHERE initiating_session_id IS NOT NULL;

CREATE TRIGGER identity_auth_intent_session_fk_bridge
BEFORE INSERT ON identity_auth_intent
WHEN NEW.initiating_session_id IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO identity_session_before_password (id)
  VALUES (NEW.initiating_session_id);
END;

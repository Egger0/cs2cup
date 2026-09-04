CREATE INDEX IF NOT EXISTS identity_security_event_created_idx
ON identity_security_event(created_at DESC, id DESC);

ALTER TABLE handbook_document ADD COLUMN game_id INTEGER REFERENCES game(id) ON DELETE RESTRICT;
CREATE INDEX handbook_document_game_idx ON handbook_document(game_id, created_at);

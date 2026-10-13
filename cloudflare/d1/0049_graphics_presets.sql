CREATE TABLE graphics_preset (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 60 AND title = trim(title)),
  hardware TEXT NOT NULL CHECK (length(hardware) BETWEEN 1 AND 80),
  target TEXT NOT NULL DEFAULT '' CHECK (length(target) <= 40),
  author TEXT NOT NULL DEFAULT '' CHECK (length(author) <= 30),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 300),
  settings TEXT NOT NULL CHECK (length(settings) BETWEEN 1 AND 4000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX graphics_preset_game ON graphics_preset (game_id, created_at);

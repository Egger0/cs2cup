PRAGMA foreign_keys = ON;

CREATE TABLE site_setting (id INTEGER PRIMARY KEY CHECK (id = 1), club_name TEXT NOT NULL, club_name_en TEXT, school TEXT NOT NULL, logo_url TEXT, contact_qq TEXT, contact_wechat TEXT, footer_copy TEXT);
CREATE TABLE game (id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, name_en TEXT, accent_color TEXT, tagline TEXT, description TEXT, format_note TEXT, sort_order INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)));
CREATE TABLE tournament (id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, game_id INTEGER REFERENCES game(id) ON DELETE RESTRICT, season TEXT NOT NULL, edition INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','registration','running','finished','postponed')), format TEXT NOT NULL DEFAULT 'single_elimination', team_cap INTEGER NOT NULL CHECK (team_cap > 0), reg_deadline TEXT, starts_at TEXT, accent_color TEXT, map_pool TEXT NOT NULL DEFAULT '[]', rules TEXT NOT NULL DEFAULT '[]', faqs TEXT NOT NULL DEFAULT '[]', hero_eyebrow TEXT NOT NULL DEFAULT '', hero_top TEXT NOT NULL DEFAULT '', hero_bottom TEXT NOT NULL DEFAULT '', lede TEXT NOT NULL DEFAULT '', champion_name TEXT, champion_note TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE team (id INTEGER PRIMARY KEY, tournament_id INTEGER NOT NULL REFERENCES tournament(id) ON DELETE CASCADE, name TEXT NOT NULL, tag TEXT NOT NULL, captain TEXT NOT NULL, contact TEXT NOT NULL, dept TEXT, note TEXT, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')), seed INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(tournament_id, tag), UNIQUE(tournament_id, name));
CREATE TABLE player (id INTEGER PRIMARY KEY, team_id INTEGER NOT NULL REFERENCES team(id) ON DELETE CASCADE, nickname TEXT NOT NULL, role TEXT, is_substitute INTEGER NOT NULL DEFAULT 0 CHECK (is_substitute IN (0, 1)), sort_order INTEGER NOT NULL DEFAULT 0, UNIQUE(team_id, nickname));
CREATE TABLE match (id INTEGER PRIMARY KEY, tournament_id INTEGER NOT NULL REFERENCES tournament(id) ON DELETE CASCADE, round INTEGER NOT NULL, slot INTEGER NOT NULL, round_label TEXT NOT NULL, best_of INTEGER NOT NULL DEFAULT 3 CHECK (best_of % 2 = 1), team_a_id INTEGER REFERENCES team(id) ON DELETE SET NULL, team_b_id INTEGER REFERENCES team(id) ON DELETE SET NULL, source_match_a_id INTEGER REFERENCES match(id) ON DELETE SET NULL, source_match_b_id INTEGER REFERENCES match(id) ON DELETE SET NULL, score_a INTEGER CHECK (score_a >= 0), score_b INTEGER CHECK (score_b >= 0), winner_team_id INTEGER REFERENCES team(id) ON DELETE SET NULL, scheduled_at TEXT, UNIQUE(tournament_id, round, slot));
CREATE TABLE match_map (id INTEGER PRIMARY KEY, match_id INTEGER NOT NULL REFERENCES match(id) ON DELETE CASCADE, pick_order INTEGER NOT NULL, map_name TEXT NOT NULL, action TEXT NOT NULL CHECK (action IN ('ban','pick','decider')), chosen_by TEXT CHECK (chosen_by IN ('a','b')), score_a INTEGER CHECK (score_a >= 0), score_b INTEGER CHECK (score_b >= 0), played INTEGER NOT NULL DEFAULT 0 CHECK (played IN (0, 1)), UNIQUE(match_id, pick_order));
CREATE TABLE photo (id INTEGER PRIMARY KEY, tournament_id INTEGER NOT NULL REFERENCES tournament(id) ON DELETE CASCADE, storage_key TEXT NOT NULL UNIQUE, width INTEGER NOT NULL CHECK (width > 0), height INTEGER NOT NULL CHECK (height > 0), blur_data_url TEXT, caption TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE club_member (id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL UNIQUE, handle TEXT, intro TEXT, sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE post (id INTEGER PRIMARY KEY, game_id INTEGER REFERENCES game(id) ON DELETE SET NULL, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, summary TEXT NOT NULL, body TEXT NOT NULL, published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)));
CREATE TABLE registration_attempt (id INTEGER PRIMARY KEY, fingerprint TEXT NOT NULL, tournament_id INTEGER REFERENCES tournament(id) ON DELETE CASCADE, accepted INTEGER NOT NULL DEFAULT 0 CHECK (accepted IN (0, 1)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX tournament_status_idx ON tournament(status);
CREATE INDEX team_tournament_status_idx ON team(tournament_id, status);
CREATE INDEX match_tournament_idx ON match(tournament_id, round, slot);
CREATE INDEX photo_tournament_idx ON photo(tournament_id, sort_order);
CREATE INDEX registration_attempt_window_idx ON registration_attempt(fingerprint, created_at DESC);
CREATE TRIGGER registration_attempt_limit_before_insert BEFORE INSERT ON registration_attempt
WHEN (SELECT COUNT(*) FROM registration_attempt WHERE fingerprint = NEW.fingerprint AND created_at > datetime('now', '-1 hour')) >= 3
BEGIN SELECT RAISE(ABORT, '提交太频繁'); END;
CREATE TRIGGER team_capacity_before_insert BEFORE INSERT ON team
WHEN NEW.status != 'rejected' AND (SELECT COUNT(*) FROM team WHERE tournament_id = NEW.tournament_id AND status != 'rejected') >= (SELECT team_cap FROM tournament WHERE id = NEW.tournament_id)
BEGIN SELECT RAISE(ABORT, '席位已满'); END;
CREATE TRIGGER team_capacity_before_update BEFORE UPDATE OF status ON team
WHEN NEW.status != 'rejected' AND OLD.status = 'rejected' AND (SELECT COUNT(*) FROM team WHERE tournament_id = NEW.tournament_id AND status != 'rejected') >= (SELECT team_cap FROM tournament WHERE id = NEW.tournament_id)
BEGIN SELECT RAISE(ABORT, '席位已满'); END;
CREATE VIEW tournament_public AS SELECT * FROM tournament WHERE status != 'draft';
CREATE VIEW team_public AS SELECT id, tournament_id, name, tag, captain, dept, seed FROM team WHERE status = 'approved';
CREATE VIEW player_public AS SELECT p.id, p.team_id, p.nickname, p.role, p.is_substitute, p.sort_order, t.tournament_id FROM player p JOIN team t ON t.id = p.team_id WHERE t.status = 'approved';
CREATE VIEW match_public AS SELECT m.* FROM match m JOIN tournament t ON t.id = m.tournament_id WHERE t.status != 'draft';
CREATE VIEW photo_public AS SELECT p.* FROM photo p JOIN tournament t ON t.id = p.tournament_id WHERE t.status != 'draft';
CREATE VIEW match_map_public AS SELECT mm.* FROM match_map mm JOIN match m ON m.id = mm.match_id JOIN tournament t ON t.id = m.tournament_id WHERE t.status != 'draft';

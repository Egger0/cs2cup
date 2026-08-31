INSERT OR IGNORE INTO game (
  id, slug, name, name_en, accent_color, tagline, description, format_note, sort_order
) VALUES (
  1, 'cs2', '反恐精英 2', 'Counter-Strike 2', '#f59e0b',
  '校内竞技，从这里开场。', '面向校内玩家的团队竞技项目。', '5v5 · MR12', 1
);

INSERT OR IGNORE INTO tournament (
  id, slug, title, game_id, season, edition, status, team_cap, reg_deadline, starts_at,
  accent_color, map_pool, rules, faqs, hero_eyebrow, hero_top, hero_bottom, lede
) VALUES (
  1, '2026-nlc', '2026 NLC 校园杯', 1, '2026', 1, 'registration', 8,
  '2099-09-01T12:00:00Z', '2099-09-12T05:00:00Z', '#f59e0b',
  '["Ancient","Anubis","Dust II","Inferno","Mirage","Nuke","Train"]',
  '[{"label":"01","title":"比赛形式","body":"采用 5v5 单败淘汰赛。"},{"label":"02","title":"参赛资格","body":"参赛队员须为本校在读学生。"}]',
  '[{"question":"需要自备设备吗？","answer":"请自备耳机及常用外设。"}]',
  'NINGBOTECH LAN CUP', '为热爱组队', '为荣誉开战',
  '这是仅用于本地开发的确定性赛事数据。'
);

INSERT OR IGNORE INTO team (
  id, tournament_id, name, tag, captain, contact, dept, status, seed
) VALUES
  (1, 1, 'Falcons', 'FLC', 'Aster', 'local-only', '计算机学院', 'approved', 1),
  (2, 1, 'Mirage', 'MRG', 'Breeze', 'local-only', '传媒学院', 'approved', 2),
  (3, 1, 'Night Owls', 'NOW', 'Cipher', 'local-only', '商学院', 'approved', 3),
  (4, 1, 'Vertex', 'VTX', 'Delta', 'local-only', '设计学院', 'approved', 4);

INSERT OR IGNORE INTO player (id, team_id, nickname, role, is_substitute, sort_order) VALUES
  (1, 1, 'Aster', 'IGL', 0, 1),
  (2, 1, 'Flint', 'Rifler', 0, 2),
  (3, 1, 'Grove', 'AWPer', 0, 3),
  (4, 1, 'Halo', 'Rifler', 0, 4),
  (5, 1, 'Ion', 'Support', 0, 5),
  (6, 2, 'Breeze', 'IGL', 0, 1),
  (7, 2, 'Moss', 'Rifler', 0, 2),
  (8, 2, 'Quartz', 'AWPer', 0, 3),
  (9, 2, 'Rook', 'Rifler', 0, 4),
  (10, 2, 'Vale', 'Support', 0, 5),
  (11, 3, 'Cipher', 'IGL', 0, 1),
  (12, 3, 'Nova', 'Rifler', 0, 2),
  (13, 3, 'Orbit', 'AWPer', 0, 3),
  (14, 3, 'Pulse', 'Rifler', 0, 4),
  (15, 3, 'Rune', 'Support', 0, 5),
  (16, 4, 'Delta', 'IGL', 0, 1),
  (17, 4, 'Echo', 'AWPer', 0, 2),
  (18, 4, 'Frost', 'Rifler', 0, 3),
  (19, 4, 'Glint', 'Rifler', 0, 4),
  (20, 4, 'Hex', 'Support', 0, 5);

INSERT OR IGNORE INTO match (
  id, tournament_id, round, slot, round_label, best_of, team_a_id, team_b_id, scheduled_at
) VALUES
  (1, 1, 0, 0, '半决赛', 3, 1, 4, '2099-09-12T05:00:00Z'),
  (2, 1, 0, 1, '半决赛', 3, 2, 3, '2099-09-12T07:00:00Z');

INSERT OR IGNORE INTO match (
  id, tournament_id, round, slot, round_label, best_of, source_match_a_id,
  source_match_b_id, scheduled_at
) VALUES (3, 1, 1, 0, '决赛', 3, 1, 2, '2099-09-13T06:00:00Z');

INSERT OR IGNORE INTO match_map (
  id, match_id, pick_order, map_name, action, chosen_by, score_a, score_b, played
) VALUES (1, 1, 1, 'Mirage', 'pick', 'a', NULL, NULL, 0);

INSERT OR IGNORE INTO club_member (id, name, role, handle, intro, sort_order) VALUES
  (1, '本地管理员', '赛事负责人', 'local-admin', '仅用于本地开发。', 1);

INSERT OR IGNORE INTO post (
  id, game_id, slug, title, summary, body, published_at, pinned
) VALUES (
  1, 1, 'local-development', '本地开发环境已就绪',
  '这是一条确定性示例动态。', '所有内容均保存在本机，不会连接远端资源。',
  '2099-01-01T00:00:00Z', 1
);

INSERT OR IGNORE INTO guestbook_message (
  id, name, body, status, is_official, pinned, created_at
) VALUES (1, '本地访客', '祝比赛顺利！', 'published', 0, 1, '2099-01-01T00:00:00Z');

INSERT OR IGNORE INTO admin_account (
  id, username, password_salt, password_hash
) VALUES (
  1, 'local-admin', 'cs2cup-local-v1',
  'c04fc96b2aa5ff14335d19385244c15110ded8a1e5569066a5e54733c62a25a4'
);

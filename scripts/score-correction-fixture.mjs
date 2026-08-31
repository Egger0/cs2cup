import { DatabaseSync } from 'node:sqlite'

class D1Statement {
  constructor(database, sql, parameters = []) {
    this.database = database
    this.sql = sql
    this.parameters = parameters
  }

  bind(...parameters) {
    return new D1Statement(this.database, this.sql, parameters)
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.parameters) ?? null
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.parameters) }
  }

  async run() {
    return this.database.prepare(this.sql).run(...this.parameters)
  }
}

class D1Database {
  constructor(database) {
    this.database = database
  }

  prepare(sql) {
    return new D1Statement(this.database, sql)
  }

  async batch(statements) {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      this.database.exec('COMMIT')
      return results
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }
}

const schema = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE tournament (
    id INTEGER PRIMARY KEY,
    map_pool TEXT NOT NULL,
    champion_name TEXT
  );
  CREATE TABLE team (
    id INTEGER PRIMARY KEY,
    tournament_id INTEGER NOT NULL REFERENCES tournament(id),
    name TEXT NOT NULL
  );
  CREATE TABLE match (
    id INTEGER PRIMARY KEY,
    tournament_id INTEGER NOT NULL REFERENCES tournament(id),
    round INTEGER NOT NULL,
    slot INTEGER NOT NULL,
    best_of INTEGER NOT NULL,
    team_a_id INTEGER REFERENCES team(id),
    team_b_id INTEGER REFERENCES team(id),
    source_match_a_id INTEGER REFERENCES match(id),
    source_match_b_id INTEGER REFERENCES match(id),
    score_a INTEGER,
    score_b INTEGER,
    winner_team_id INTEGER REFERENCES team(id)
  );
  CREATE TABLE match_map (
    id INTEGER PRIMARY KEY,
    match_id INTEGER NOT NULL REFERENCES match(id) ON DELETE CASCADE,
    pick_order INTEGER NOT NULL,
    map_name TEXT NOT NULL,
    action TEXT NOT NULL,
    chosen_by TEXT,
    score_a INTEGER,
    score_b INTEGER,
    played INTEGER NOT NULL
  );
`

export function scoreCorrectionFixture() {
  const database = new DatabaseSync(':memory:')
  database.exec(schema)
  database
    .prepare('INSERT INTO tournament (id,map_pool,champion_name) VALUES (1,?,?)')
    .run(JSON.stringify(['Mirage', 'Inferno', 'Nuke']), 'Alpha')
  for (const [id, name] of [
    'Alpha',
    'Bravo',
    'Charlie',
    'Delta',
    'Echo',
    'Foxtrot',
    'Golf',
    'Hotel',
  ].entries()) {
    database.prepare('INSERT INTO team (id,tournament_id,name) VALUES (?,1,?)').run(id + 1, name)
  }
  const insertMatch = database.prepare(
    'INSERT INTO match (id,tournament_id,round,slot,best_of,team_a_id,team_b_id,source_match_a_id,source_match_b_id,score_a,score_b,winner_team_id) VALUES (?,1,?,?,?,?,?,?,?,?,?,?)',
  )
  insertMatch.run(10, 0, 0, 3, 1, 2, null, null, 2, 0, 1)
  insertMatch.run(11, 0, 1, 3, 3, 4, null, null, 2, 0, 3)
  insertMatch.run(12, 0, 2, 3, 5, 6, null, null, 2, 0, 5)
  insertMatch.run(13, 0, 3, 3, 7, 8, null, null, 2, 0, 7)
  insertMatch.run(20, 1, 0, 3, null, null, 10, 11, 2, 0, 1)
  insertMatch.run(21, 1, 1, 3, null, null, 12, 13, 2, 0, 5)
  insertMatch.run(30, 2, 0, 3, null, null, 20, 21, 2, 1, 1)
  for (const [id, matchId, mapName] of [
    [101, 10, 'Mirage'],
    [201, 20, 'Inferno'],
    [301, 30, 'Nuke'],
  ]) {
    database
      .prepare(
        "INSERT INTO match_map (id,match_id,pick_order,map_name,action,chosen_by,score_a,score_b,played) VALUES (?,?,1,?,'pick','a',13,5,1)",
      )
      .run(id, matchId, mapName)
  }
  globalThis.__scoreCorrectionBindings = { db: new D1Database(database), media: {} }
  return database
}

export function scoreCorrectionState(database) {
  return {
    champion: database.prepare('SELECT champion_name FROM tournament WHERE id = 1').get(),
    matches: database
      .prepare('SELECT id,score_a,score_b,winner_team_id FROM match ORDER BY id')
      .all(),
    maps: database.prepare('SELECT match_id,map_name FROM match_map ORDER BY match_id').all(),
  }
}

export function plainRow(row) {
  return { ...row }
}

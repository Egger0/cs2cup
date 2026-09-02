import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { DatabaseSync } from 'node:sqlite'

const bindingsModule =
  'data:text/javascript,export function cloudflareBindings(){return globalThis.__registrationManagementBindings}'
const CHECKED_IN_AT = '2026-09-03T02:15:00.000Z'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only')
      return { url: 'data:text/javascript,export {}', shortCircuit: true }
    if (specifier === '../cloudflare-bindings') {
      return { url: bindingsModule, shortCircuit: true }
    }
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith('.') || /\.[a-z]+$/i.test(specifier)) throw error
      return nextResolve(`${specifier}.ts`, context)
    }
  },
})

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

  run() {
    return this.database.prepare(this.sql).run(...this.parameters)
  }
}

class D1Database {
  constructor(database) {
    this.database = database
    this.beforeBatch = null
  }

  prepare(sql) {
    return new D1Statement(this.database, sql)
  }

  async batch(statements) {
    const beforeBatch = this.beforeBatch
    this.beforeBatch = null
    beforeBatch?.(this.database)

    this.database.exec('BEGIN IMMEDIATE')
    try {
      const results = statements.map(statement => statement.run())
      this.database.exec('COMMIT')
      return results
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }
}

const { createRegistrationAccess } = await import('../lib/registration-access.ts')
const { getManagedRegistration, RegistrationManagementError, saveManagedRegistration } =
  await import('../lib/queries/registration-management.ts')

const schema = `
  PRAGMA foreign_keys = ON;
  CREATE TABLE tournament (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    reg_deadline TEXT
  );
  CREATE TABLE team (
    id INTEGER PRIMARY KEY,
    tournament_id INTEGER NOT NULL REFERENCES tournament(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    tag TEXT NOT NULL,
    captain TEXT NOT NULL,
    contact TEXT NOT NULL,
    dept TEXT,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    seed INTEGER,
    checked_in_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    management_token_hash TEXT UNIQUE,
    management_revision INTEGER NOT NULL DEFAULT 0 CHECK (management_revision >= 0),
    management_write_nonce TEXT,
    UNIQUE(tournament_id, name),
    UNIQUE(tournament_id, tag)
  );
  CREATE TABLE player (
    id INTEGER PRIMARY KEY,
    team_id INTEGER NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    nickname TEXT NOT NULL,
    role TEXT,
    is_substitute INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL,
    UNIQUE(team_id, nickname)
  );
  CREATE UNIQUE INDEX team_tournament_name_nocase_idx
  ON team(tournament_id, name COLLATE NOCASE);
  CREATE UNIQUE INDEX team_tournament_tag_nocase_idx
  ON team(tournament_id, tag COLLATE NOCASE);
  CREATE TRIGGER team_management_revision_increment_before_update
  BEFORE UPDATE OF management_revision ON team
  WHEN NEW.management_revision != OLD.management_revision + 1
    OR NEW.management_write_nonce IS NULL
    OR NEW.management_write_nonce IS OLD.management_write_nonce
  BEGIN
    SELECT RAISE(ABORT, 'registration revision conflict');
  END;
`

const players = suffix =>
  ['One', 'Two', 'Three', 'Four', 'Five'].map(name => ({
    nickname: `${name}${suffix}`,
    substitute: false,
  }))

async function scenario() {
  const database = new DatabaseSync(':memory:')
  database.exec(schema)
  const access = await createRegistrationAccess()
  database
    .prepare(
      "INSERT INTO tournament (id,slug,title,status,reg_deadline) VALUES (1,'cup','Cup','registration','2999-01-01T00:00:00Z')",
    )
    .run()
  database
    .prepare(
      "INSERT INTO team (id,tournament_id,name,tag,captain,contact,status,management_token_hash) VALUES (1,1,'Alpha','AAA','Captain','contact','pending',?)",
    )
    .run(access.tokenHash)
  for (const [index, player] of players('A').entries()) {
    database
      .prepare('INSERT INTO player (team_id,nickname,is_substitute,sort_order) VALUES (1,?,?,?)')
      .run(player.nickname, 0, index + 1)
  }
  const d1 = new D1Database(database)
  globalThis.__registrationManagementBindings = { db: d1 }
  return { access, database, d1 }
}

const update = suffix => ({
  name: `Beta${suffix}`,
  tag: `B${suffix}`,
  captain: `Captain${suffix}`,
  contact: `contact-${suffix}`,
  dept: null,
  note: null,
  players: players(suffix),
})

async function expectManagementError(work, code) {
  await assert.rejects(work, error => {
    assert.equal(error instanceof RegistrationManagementError, true)
    assert.equal(error.code, code)
    return true
  })
}

{
  const { access, database } = await scenario()
  const registration = await getManagedRegistration('cup', access.token)
  assert.equal(registration?.editable, true)
  assert.equal(registration?.revision, 0)
  assert.equal(registration?.team.checkedInAt, null)
  assert.equal(await getManagedRegistration('wrong-cup', access.token), null)
  assert.equal(await getManagedRegistration('cup', 'Z'.repeat(43)), null)
  const firstUpdate = await saveManagedRegistration('cup', access.token, 0, update('OK'))
  assert.equal(firstUpdate.revision, 1)
  assert.equal(database.prepare('SELECT name FROM team WHERE id = 1').get().name, 'BetaOK')
  assert.deepEqual(
    database
      .prepare('SELECT nickname FROM player WHERE team_id = 1 ORDER BY sort_order')
      .all()
      .map(row => row.nickname),
    players('OK').map(player => player.nickname),
  )
  const secondUpdate = await saveManagedRegistration('cup', access.token, 1, update('Again'))
  assert.equal(secondUpdate.revision, 2)
  database
    .prepare("UPDATE team SET status = 'approved', checked_in_at = ? WHERE id = 1")
    .run(CHECKED_IN_AT)
  const checkedIn = await getManagedRegistration('cup', access.token)
  assert.equal(checkedIn?.team.checkedInAt, CHECKED_IN_AT)
}

for (const [code, concurrentChange] of [
  [
    'locked',
    database => database.prepare("UPDATE team SET status = 'approved' WHERE id = 1").run(),
  ],
  [
    'locked',
    database =>
      database.prepare("UPDATE tournament SET reg_deadline = '2000-01-01T00:00:00Z'").run(),
  ],
  [
    'invalid_token',
    database => database.prepare('UPDATE team SET management_token_hash = NULL WHERE id = 1').run(),
  ],
]) {
  const { access, database, d1 } = await scenario()
  d1.beforeBatch = concurrentChange
  await expectManagementError(saveManagedRegistration('cup', access.token, 0, update(code)), code)
  assert.equal(database.prepare('SELECT name FROM team WHERE id = 1').get().name, 'Alpha')
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM player WHERE team_id = 1').get().count,
    5,
  )
}

{
  const { access, database, d1 } = await scenario()
  d1.beforeBatch = current =>
    current
      .prepare(
        "INSERT INTO team (id,tournament_id,name,tag,captain,contact,status) VALUES (2,1,'betaDup','OTHER','Other','other','pending')",
      )
      .run()
  await expectManagementError(
    saveManagedRegistration('cup', access.token, 0, { ...update('Dup'), name: 'BetaDup' }),
    'duplicate',
  )
  assert.equal(database.prepare('SELECT name FROM team WHERE id = 1').get().name, 'Alpha')
}

{
  const { access, database } = await scenario()
  const first = await saveManagedRegistration('cup', access.token, 0, update('First'))
  assert.equal(first.revision, 1)
  await expectManagementError(
    saveManagedRegistration('cup', access.token, 0, update('Stale')),
    'conflict',
  )
  assert.equal(database.prepare('SELECT name FROM team WHERE id = 1').get().name, 'BetaFirst')
  assert.deepEqual(
    database
      .prepare('SELECT nickname FROM player WHERE team_id = 1 ORDER BY sort_order')
      .all()
      .map(row => row.nickname),
    players('First').map(player => player.nickname),
  )
}

{
  const { access, database, d1 } = await scenario()
  d1.beforeBatch = current => {
    current
      .prepare(
        "UPDATE team SET management_revision = 1, management_write_nonce = 'concurrent' WHERE id = 1",
      )
      .run()
    current.prepare('DELETE FROM player WHERE team_id = 1').run()
    for (const [index, player] of players('Concurrent').entries()) {
      current
        .prepare('INSERT INTO player (team_id,nickname,is_substitute,sort_order) VALUES (1,?,?,?)')
        .run(player.nickname, 0, index + 1)
    }
  }
  const rosterOnlyUpdate = {
    name: 'Alpha',
    tag: 'AAA',
    captain: 'Captain',
    contact: 'contact',
    dept: null,
    note: null,
    players: players('Proposed'),
  }
  await expectManagementError(
    saveManagedRegistration('cup', access.token, 0, rosterOnlyUpdate),
    'conflict',
  )
  assert.equal(
    database.prepare('SELECT management_revision FROM team WHERE id = 1').get().management_revision,
    1,
  )
  assert.deepEqual(
    database
      .prepare('SELECT nickname FROM player WHERE team_id = 1 ORDER BY sort_order')
      .all()
      .map(row => row.nickname),
    players('Concurrent').map(player => player.nickname),
  )
}

console.log('registration management D1 tests passed')

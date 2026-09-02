import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

import { createMigratedDatabase } from './sqlite-fixture.mjs'

const PRINCIPAL = `p_${'A'.repeat(43)}`
const OTHER_PRINCIPAL = `p_${'B'.repeat(43)}`
const CHECKED_IN_AT = '2026-09-03T02:15:00.000Z'
const NOW = Date.parse('2026-09-03T03:00:00.000Z')

const bindingsModule =
  'data:text/javascript,export function cloudflareBindings(){return globalThis.__participantAccountBindings}'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') {
      return { url: 'data:text/javascript,export {}', shortCircuit: true }
    }
    if (specifier === '../cloudflare-bindings.ts') {
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
  constructor(owner, sql, parameters = []) {
    this.owner = owner
    this.sql = sql
    this.parameters = parameters
  }

  bind(...parameters) {
    return new D1Statement(this.owner, this.sql, parameters)
  }

  async all() {
    this.owner.queries.push({ sql: this.sql, parameters: this.parameters })
    return { results: this.owner.database.prepare(this.sql).all(...this.parameters) }
  }
}

class D1Database {
  constructor(database) {
    this.database = database
    this.queries = []
  }

  prepare(sql) {
    return new D1Statement(this, sql)
  }
}

const { participantCheckInReceipt } = await import('../lib/check-in-receipt.ts')
const { listParticipantTournamentEntries } = await import('../lib/queries/participant-account.ts')
const database = await createMigratedDatabase()

assert.deepEqual(participantCheckInReceipt('pending', 'not-a-date', NOW), {
  state: 'waiting-review',
  label: '审核通过后开放',
  instant: null,
  timeLabel: null,
})
assert.deepEqual(participantCheckInReceipt('rejected', '2999-01-01T00:00:00.000Z', NOW), {
  state: 'not-applicable',
  label: '报名未通过，无法签到',
  instant: null,
  timeLabel: null,
})
assert.deepEqual(participantCheckInReceipt('approved', null, NOW), {
  state: 'not-recorded',
  label: '未签到',
  instant: null,
  timeLabel: null,
})
assert.deepEqual(participantCheckInReceipt('approved', CHECKED_IN_AT, NOW), {
  state: 'checked-in',
  label: '已签到',
  instant: CHECKED_IN_AT,
  timeLabel: '2026年9月3日 · 周四 · 10:15',
})
for (const unsafeTimestamp of [
  '',
  'not-a-date',
  '2026-09-03T03:00:00',
  '2999-01-01T00:00:00.000Z',
]) {
  const receipt = participantCheckInReceipt('approved', unsafeTimestamp, NOW)
  assert.deepEqual(receipt, {
    state: 'unavailable',
    label: '状态待确认',
    instant: null,
    timeLabel: null,
  })
  if (unsafeTimestamp) assert.equal(JSON.stringify(receipt).includes(unsafeTimestamp), false)
}

try {
  database.exec(`
    INSERT INTO game (id, slug, name) VALUES (1, 'cs2', 'CS2');
    INSERT INTO tournament (id, slug, title, game_id, season, edition, status, team_cap)
    VALUES (1, 'account-cup', 'Account Cup', 1, '2026', 1, 'running', 8);
  `)
  database
    .prepare('INSERT INTO participant_principal (id, webauthn_user_handle) VALUES (?, ?)')
    .run(PRINCIPAL, 'U'.repeat(43))
  database
    .prepare('INSERT INTO participant_principal (id, webauthn_user_handle) VALUES (?, ?)')
    .run(OTHER_PRINCIPAL, 'V'.repeat(43))
  database.exec(`
    INSERT INTO team
      (id, tournament_id, name, tag, captain, contact, status, checked_in_at)
    VALUES
      (10, 1, 'Checked Team', 'YES', 'Captain One', 'private-one', 'approved', '${CHECKED_IN_AT}'),
      (11, 1, 'Unchecked Team', 'NO', 'Captain Two', 'private-two', 'approved', NULL),
      (12, 1, 'Pending Team', 'WAIT', 'Captain Three', 'private-three', 'pending', NULL),
      (20, 1, 'Other Team', 'OTHER', 'Other Captain', 'other-private', 'approved', '${CHECKED_IN_AT}');
    INSERT INTO player (id, team_id, nickname, is_substitute, sort_order)
    VALUES
      (1, 10, 'Second', 1, 2),
      (2, 10, 'First', 0, 1),
      (3, 11, 'Solo', 0, 1),
      (4, 20, 'Other Private Player', 0, 1);
  `)
  for (const teamId of [10, 11, 12]) {
    database
      .prepare('INSERT INTO tournament_entry_owner (team_id, principal_id) VALUES (?, ?)')
      .run(teamId, PRINCIPAL)
  }
  database
    .prepare('INSERT INTO tournament_entry_owner (team_id, principal_id) VALUES (?, ?)')
    .run(20, OTHER_PRINCIPAL)

  const d1 = new D1Database(database)
  globalThis.__participantAccountBindings = { db: d1 }
  const entries = await listParticipantTournamentEntries(PRINCIPAL)

  assert.equal(d1.queries.length, 1, 'participant entries must remain a single joined query')
  assert.deepEqual(d1.queries[0].parameters, [PRINCIPAL])
  assert.match(d1.queries[0].sql, /team\.checked_in_at/)
  assert.match(d1.queries[0].sql, /LEFT JOIN player/)
  assert.equal(entries.length, 3)

  const byId = new Map(entries.map(entry => [entry.team.id, entry]))
  assert.equal(byId.get(10)?.team.checkedInAt, CHECKED_IN_AT)
  assert.equal(byId.get(11)?.team.checkedInAt, null)
  assert.equal(byId.get(12)?.team.checkedInAt, null)
  assert.deepEqual(
    byId.get(10)?.team.members.map(member => ({
      nickname: member.nickname,
      substitute: member.isSubstitute,
    })),
    [
      { nickname: 'First', substitute: false },
      { nickname: 'Second', substitute: true },
    ],
  )
  assert.equal(
    entries.some(entry => entry.team.id === 20),
    false,
  )
  assert.equal(JSON.stringify(entries).includes('Other Private Player'), false)

  console.log('participant account tests passed')
} finally {
  delete globalThis.__participantAccountBindings
  database.close()
}

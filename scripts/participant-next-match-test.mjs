import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

import { createMigratedDatabase } from './sqlite-fixture.mjs'

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith('.') || /\.[a-z]+$/i.test(specifier)) throw error
      return nextResolve(`${specifier}.ts`, context)
    }
  },
})

const { participantNextMatchFromDatabase } =
  await import('../lib/queries/participant-next-match.ts')

const NOW = Date.parse('2026-11-15T04:00:00Z')
const PRINCIPAL = `p_${'A'.repeat(43)}`
const OTHER_PRINCIPAL = `p_${'B'.repeat(43)}`

const TIME = {
  draft: '2026-11-15T05:00:00Z',
  finished: '2026-11-15T05:10:00Z',
  postponed: '2026-11-15T05:20:00Z',
  pending: '2026-11-15T05:30:00Z',
  rejected: '2026-11-15T05:40:00Z',
  other: '2026-11-15T05:50:00Z',
  bye: '2026-11-15T06:00:00Z',
  completed: '2026-11-15T06:10:00Z',
  crossTournament: '2026-11-15T07:00:00Z',
  sourcePending: '2026-11-15T08:00:00Z',
  resolvedNext: '2026-11-15T09:00:00Z',
}

function d1Adapter(database) {
  const queries = []
  return {
    queries,
    reset() {
      queries.length = 0
    },
    prepare(query) {
      queries.push(query)
      const statement = database.prepare(query)
      let bindings = []
      const prepared = {
        bind(...values) {
          bindings = values
          return prepared
        },
        async all() {
          return { results: statement.all(...bindings) }
        },
      }
      return prepared
    },
  }
}

function insertTournament(database, id, slug, title, status) {
  database
    .prepare(
      "INSERT INTO tournament (id, slug, title, game_id, season, edition, status, team_cap) VALUES (?, ?, ?, 1, '2026', ?, ?, 16)",
    )
    .run(id, slug, title, id, status)
}

function insertTeam(database, id, tournamentId, name, tag, status = 'approved') {
  database
    .prepare(
      "INSERT INTO team (id, tournament_id, name, tag, captain, contact, status) VALUES (?, ?, ?, ?, 'Captain', 'private-contact', ?)",
    )
    .run(id, tournamentId, name, tag, status)
}

function insertMatch(
  database,
  {
    id,
    tournamentId,
    slot,
    label,
    scheduledAt,
    round = 0,
    teamA = null,
    teamB = null,
    sourceA = null,
    sourceB = null,
    scoreA = null,
    scoreB = null,
    winner = null,
  },
) {
  database
    .prepare(
      `INSERT INTO match (
        id, tournament_id, round, slot, round_label, best_of,
        team_a_id, team_b_id, source_match_a_id, source_match_b_id,
        score_a, score_b, winner_team_id, scheduled_at
      ) VALUES (?, ?, ?, ?, ?, 3, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      tournamentId,
      round,
      slot,
      label,
      teamA,
      teamB,
      sourceA,
      sourceB,
      scoreA,
      scoreB,
      winner,
      scheduledAt,
    )
}

function own(database, teamId, principalId = PRINCIPAL) {
  database
    .prepare('INSERT INTO tournament_entry_owner (team_id, principal_id) VALUES (?, ?)')
    .run(teamId, principalId)
}

function assertTwoPublicQueries(adapter) {
  assert.equal(adapter.queries.length, 2, 'one lookup must remain exactly two database queries')
  const sql = adapter.queries.join('\n')
  assert.match(sql, /FROM team_public/)
  assert.match(sql, /FROM match_public/)
}

const database = await createMigratedDatabase()

try {
  database.prepare("INSERT INTO game (id, slug, name) VALUES (1, 'cs2', 'CS2')").run()
  database
    .prepare('INSERT INTO participant_principal (id, webauthn_user_handle) VALUES (?, ?)')
    .run(PRINCIPAL, 'U'.repeat(43))
  database
    .prepare('INSERT INTO participant_principal (id, webauthn_user_handle) VALUES (?, ?)')
    .run(OTHER_PRINCIPAL, 'V'.repeat(43))

  insertTournament(database, 1, 'primary-cup', 'Primary Cup', 'running')
  insertTournament(database, 2, 'cross-cup', 'Cross Cup', 'registration')
  insertTournament(database, 3, 'draft-cup', 'Draft Cup', 'draft')
  insertTournament(database, 4, 'finished-cup', 'Finished Cup', 'finished')
  insertTournament(database, 5, 'postponed-cup', 'Postponed Cup', 'postponed')
  insertTournament(database, 6, 'review-cup', 'Review Cup', 'running')
  insertTournament(database, 7, 'other-cup', 'Other Cup', 'running')

  insertTeam(database, 101, 1, 'Primary Team', 'MAIN')
  insertTeam(database, 102, 1, 'Primary Opponent', 'OPP')
  insertTeam(database, 103, 1, 'Source One', 'S1')
  insertTeam(database, 104, 1, 'Source Two', 'S2')
  insertTeam(database, 201, 2, 'Cross Team', 'CROSS')
  insertTeam(database, 202, 2, 'Cross Opponent', 'XOPP')
  insertTeam(database, 301, 3, 'Draft Team', 'DRAFT')
  insertTeam(database, 302, 3, 'Draft Opponent', 'DOPP')
  insertTeam(database, 401, 4, 'Finished Team', 'DONE')
  insertTeam(database, 402, 4, 'Finished Opponent', 'FOPP')
  insertTeam(database, 501, 5, 'Postponed Team', 'PAUSE')
  insertTeam(database, 502, 5, 'Postponed Opponent', 'POPP')
  insertTeam(database, 601, 6, 'Pending Team', 'PEND', 'pending')
  insertTeam(database, 602, 6, 'Rejected Team', 'NOPE', 'rejected')
  insertTeam(database, 603, 6, 'Review Opponent', 'ROPP')
  insertTeam(database, 701, 7, 'Other Owner Team', 'OTHER')
  insertTeam(database, 702, 7, 'Other Opponent', 'OOPP')

  for (const teamId of [101, 201, 301, 401, 501, 601, 602]) own(database, teamId)
  own(database, 701, OTHER_PRINCIPAL)

  insertMatch(database, {
    id: 1001,
    tournamentId: 1,
    slot: 0,
    label: 'Source A',
    scheduledAt: TIME.completed,
    teamA: 101,
    teamB: 102,
    scoreA: 2,
    scoreB: 0,
    winner: 101,
  })
  insertMatch(database, {
    id: 1002,
    tournamentId: 1,
    slot: 1,
    label: 'Source B',
    scheduledAt: TIME.sourcePending,
    teamA: 103,
    teamB: 104,
  })
  insertMatch(database, {
    id: 1004,
    tournamentId: 1,
    slot: 2,
    label: 'Automatic Bye',
    scheduledAt: TIME.bye,
    teamA: 101,
    winner: 101,
  })
  insertMatch(database, {
    id: 1003,
    tournamentId: 1,
    round: 1,
    slot: 0,
    label: 'Resolved Semi-final',
    scheduledAt: TIME.resolvedNext,
    sourceA: 1001,
    sourceB: 1002,
  })
  insertMatch(database, {
    id: 2001,
    tournamentId: 2,
    slot: 0,
    label: 'Cross Opener',
    scheduledAt: TIME.crossTournament,
    teamA: 201,
    teamB: 202,
  })

  for (const [id, tournamentId, teamA, teamB, scheduledAt, label] of [
    [3001, 3, 301, 302, TIME.draft, 'Draft Match'],
    [4001, 4, 401, 402, TIME.finished, 'Finished Match'],
    [5001, 5, 501, 502, TIME.postponed, 'Postponed Match'],
    [6001, 6, 601, 603, TIME.pending, 'Pending Match'],
    [6002, 6, 602, 603, TIME.rejected, 'Rejected Match'],
    [7001, 7, 701, 702, TIME.other, 'Other Principal Match'],
  ]) {
    insertMatch(database, { id, tournamentId, slot: id % 10, label, scheduledAt, teamA, teamB })
  }

  const adapter = d1Adapter(database)
  const crossTournament = await participantNextMatchFromDatabase(adapter, PRINCIPAL, NOW)
  assertTwoPublicQueries(adapter)
  assert.deepEqual(crossTournament, {
    tournament: { id: 2, slug: 'cross-cup', title: 'Cross Cup' },
    ownedTeam: { id: 201, name: 'Cross Team', tag: 'CROSS' },
    match: {
      id: 2001,
      roundLabel: 'Cross Opener',
      bestOf: 3,
      scheduledAt: TIME.crossTournament,
      status: 'upcoming',
      teamA: { id: 201, name: 'Cross Team', tag: 'CROSS' },
      teamB: { id: 202, name: 'Cross Opponent', tag: 'XOPP' },
    },
  })
  assert.equal(JSON.stringify(crossTournament).includes('private-contact'), false)
  assert.equal(JSON.stringify(crossTournament).includes(PRINCIPAL), false)

  database.prepare('DELETE FROM match WHERE id = 2001').run()
  adapter.reset()
  const resolved = await participantNextMatchFromDatabase(adapter, PRINCIPAL, NOW)
  assertTwoPublicQueries(adapter)
  assert.deepEqual(resolved, {
    tournament: { id: 1, slug: 'primary-cup', title: 'Primary Cup' },
    ownedTeam: { id: 101, name: 'Primary Team', tag: 'MAIN' },
    match: {
      id: 1003,
      roundLabel: 'Resolved Semi-final',
      bestOf: 3,
      scheduledAt: TIME.resolvedNext,
      status: 'waiting',
      teamA: { id: 101, name: 'Primary Team', tag: 'MAIN' },
      teamB: null,
    },
  })

  database.prepare('DELETE FROM match WHERE id = 1003').run()
  adapter.reset()
  assert.equal(await participantNextMatchFromDatabase(adapter, PRINCIPAL, NOW), null)
  assertTwoPublicQueries(adapter)

  console.log('participant next match tests passed')
} finally {
  database.close()
}

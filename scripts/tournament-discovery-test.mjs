import assert from 'node:assert/strict'
import {
  filterTournaments,
  readTournamentFilters,
  tournamentFilterHref,
} from '../lib/tournament-discovery.ts'

const tournaments = [
  {
    id: 1,
    title: '宁理杯 NLC',
    slug: '2026-nlc',
    status: 'registration',
    gameSlug: 'cs2',
    gameName: '反恐精英 2',
    season: '2026',
  },
  {
    id: 2,
    title: '冬季校园赛',
    slug: '2025-winter',
    status: 'finished',
    gameSlug: 'valorant',
    gameName: '无畏契约',
    season: '2025',
  },
  {
    id: 3,
    title: '未公开赛事',
    slug: 'private-cup',
    status: 'draft',
    gameSlug: 'cs2',
    gameName: '反恐精英 2',
    season: '2026',
  },
]
const ids = values => values.map(t => t.id)
assert.deepEqual(ids(filterTournaments(tournaments, readTournamentFilters({}))), [1, 2])
assert.deepEqual(
  ids(filterTournaments(tournaments, readTournamentFilters({ q: 'ＮＬＣ 2026' }))),
  [1],
)
assert.deepEqual(
  ids(filterTournaments(tournaments, readTournamentFilters({ game: 'valorant', season: '2026' }))),
  [],
)
assert.deepEqual(
  ids(filterTournaments(tournaments, readTournamentFilters({ q: '冬季', status: 'finished' }))),
  [2],
)
assert.deepEqual(
  ids(filterTournaments(tournaments, readTournamentFilters({ followed: '1' }), [2, 3])),
  [2],
)
assert.deepEqual(ids(filterTournaments(tournaments, readTournamentFilters({ followed: '1' }))), [])
assert.equal(readTournamentFilters({ status: 'draft' }).status, 'all')
assert.equal(readTournamentFilters({ q: 'x'.repeat(1000) }).q.length, 80)
assert.equal(readTournamentFilters({ q: [' NLC ', 'ignored'] }).q, 'NLC')

const filters = readTournamentFilters({
  q: '宁理 & NLC',
  status: 'registration',
  season: '2026',
  game: 'cs2',
  followed: '1',
})
const url = new URL(tournamentFilterHref(filters), 'https://example.com')
assert.equal(url.pathname, '/tournaments')
assert.deepEqual(readTournamentFilters(Object.fromEntries(url.searchParams)), filters)
assert.equal(tournamentFilterHref(readTournamentFilters({})), '/tournaments')
console.log(
  'Tournament discovery filters, Unicode search, public visibility, and shareable URLs passed',
)

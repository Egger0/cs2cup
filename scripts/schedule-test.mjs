import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

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

const {
  dateTimeLocalToIso,
  formatSiteCompactDateTime,
  formatSiteDate,
  formatSiteDateTime,
  formatSiteTime,
  isIsoInstant,
  isoToDateTimeLocal,
  siteDayKey,
} = await import('../lib/datetime.ts')
const {
  buildScheduleEntries,
  groupScheduleEntries,
  selectNextScheduleEntry,
} = await import('../lib/schedule.ts')

const tournamentId = 1

const team = (id, tag = `T${id}`) => ({
  id,
  tournamentId,
  name: `Team ${id}`,
  tag,
  captain: `Captain ${id}`,
  dept: null,
  seed: id,
  players: [],
})

const match = (id, overrides = {}) => ({
  id,
  tournamentId,
  round: 0,
  slot: id,
  roundLabel: 'Opening round',
  bestOf: 3,
  teamAId: 1,
  teamBId: 2,
  sourceMatchAId: null,
  sourceMatchBId: null,
  scoreA: null,
  scoreB: null,
  winnerTeamId: null,
  scheduledAt: null,
  ...overrides,
})

assert.equal(
  dateTimeLocalToIso('2026-11-15T00:30'),
  '2026-11-14T16:30:00.000Z',
  'site-local midnight must cross the UTC date boundary',
)
assert.equal(isoToDateTimeLocal('2026-11-14T16:30:00Z'), '2026-11-15T00:30')
assert.equal(isIsoInstant('2026-11-14T16:30:00.123456Z'), true)
assert.equal(isIsoInstant('2026-11-14T16:30:00'), false)
assert.equal(siteDayKey('2026-11-14T16:30:00Z'), '2026-11-15')
assert.equal(formatSiteDate('2026-11-14T16:30:00Z'), '2026年11月15日 · 周日')
assert.equal(formatSiteTime('2026-11-14T16:30:00Z'), '00:30')
assert.equal(formatSiteCompactDateTime('2026-11-14T16:30:00Z'), '11月15日 00:30')
assert.equal(
  formatSiteDateTime('2026-11-14T16:30:00Z'),
  '2026年11月15日 · 周日 · 00:30',
)
assert.equal(dateTimeLocalToIso('2024-02-29T23:59'), '2024-02-29T15:59:00.000Z')
assert.equal(
  dateTimeLocalToIso('1988-07-01T12:00'),
  '1988-07-01T03:00:00.000Z',
  'historical Shanghai daylight time must use the IANA zone offset',
)

for (const invalid of [
  '',
  '2026-02-29T12:00',
  '2026-02-30T12:00',
  '2026-13-01T12:00',
  '2026-01-00T12:00',
  '2026-01-01T24:00',
  '2026-01-01T12:60',
  '2026-01-01 12:00',
  '2026-01-01T12:00Z',
]) {
  assert.equal(dateTimeLocalToIso(invalid), null, `invalid local date must fail closed: ${invalid}`)
}
assert.equal(isoToDateTimeLocal('2026-02-30T12:00:00Z'), null)
assert.equal(siteDayKey('2026-11-14T12:00:00'), null, 'an instant without an offset must fail closed')
assert.equal(formatSiteTime(Number.NaN), null)
assert.equal(formatSiteDate(new Date(Number.NaN)), null)

const teams = [team(1), team(2), team(3), team(4), team(5), team(6)]
const now = Date.parse('2026-11-15T04:00:00Z')
const sourceA = match(10, {
  slot: 0,
  scheduledAt: '2026-11-14T01:00:00Z',
  scoreA: 2,
  scoreB: 0,
  winnerTeamId: 1,
})
const sourceB = match(11, {
  slot: 1,
  teamAId: 3,
  teamBId: 4,
  scheduledAt: '2026-11-14T02:00:00Z',
})
const waiting = match(20, {
  round: 1,
  slot: 0,
  teamAId: null,
  teamBId: null,
  sourceMatchAId: 10,
  sourceMatchBId: 11,
  scheduledAt: '2026-11-15T08:00:00Z',
})
const futureLate = match(22, {
  slot: 4,
  teamAId: 5,
  teamBId: 6,
  scheduledAt: '2026-11-16T08:00:00Z',
})
const futureEarly = match(21, {
  slot: 3,
  teamAId: 3,
  teamBId: 4,
  scheduledAt: '2026-11-15T06:00:00Z',
})
const overdue = match(12, {
  slot: 2,
  scheduledAt: '2026-11-15T03:00:00Z',
})
const unscheduled = match(30, { round: 2, slot: 0 })
const invalidSchedule = match(31, {
  round: 2,
  slot: 1,
  scheduledAt: '2026-02-30T12:00:00Z',
})
const bye = match(40, {
  slot: 9,
  teamBId: null,
  winnerTeamId: 1,
})
const orphanedMatch = match(41, {
  slot: 10,
  teamBId: null,
})

const entries = buildScheduleEntries(
  [
    unscheduled,
    futureLate,
    bye,
    orphanedMatch,
    waiting,
    sourceB,
    futureEarly,
    sourceA,
    invalidSchedule,
    overdue,
  ],
  teams,
  now,
)

assert.deepEqual(
  entries.map(entry => entry.match.id),
  [10, 11, 12, 21, 20, 22, 41, 30, 31],
  'scheduled matches must sort chronologically and unscheduled matches by bracket order',
)
assert.equal(entries.some(entry => entry.match.id === bye.id), false, 'byes must be excluded')
assert.equal(
  entries.some(entry => entry.match.id === orphanedMatch.id),
  true,
  'a one-sided match without an automatic winner must remain visible',
)

const byId = new Map(entries.map(entry => [entry.match.id, entry]))
assert.equal(byId.get(10)?.status, 'completed')
assert.equal(byId.get(11)?.status, 'overdue')
assert.equal(byId.get(12)?.status, 'overdue')
assert.equal(byId.get(21)?.status, 'upcoming')
assert.equal(byId.get(20)?.status, 'waiting')
assert.equal(byId.get(30)?.status, 'unscheduled')
assert.equal(byId.get(31)?.status, 'unscheduled', 'invalid timestamps must not enter dated groups')
assert.equal(byId.get(20)?.a?.id, 1, 'a later round must resolve a completed source winner')
assert.equal(byId.get(20)?.b, null, 'an unresolved source must leave its side waiting')

const groups = groupScheduleEntries(entries)
assert.deepEqual(groups.map(group => group.key), [
  '2026-11-14',
  '2026-11-15',
  '2026-11-16',
  'unscheduled',
])
assert.deepEqual(groups.at(-1)?.entries.map(entry => entry.match.id), [41, 30, 31])
assert.equal(groups[0]?.label, '2026年11月14日 · 周六')
assert.equal(groups.at(-1)?.label, '时间待定')

assert.equal(
  selectNextScheduleEntry(entries, now)?.match.id,
  futureEarly.id,
  'the earliest future match must win over bracket order and waiting later matches',
)

const withoutFuture = entries.filter(entry => entry.scheduledTime === null || entry.scheduledTime < now)
assert.equal(
  selectNextScheduleEntry(withoutFuture, now)?.match.id,
  overdue.id,
  'the closest playable overdue match must be the fallback',
)

const unresolvedOverdue = buildScheduleEntries([
  match(50, {
    round: 2,
    slot: 0,
    teamAId: null,
    teamBId: null,
    sourceMatchAId: 98,
    sourceMatchBId: 99,
    scheduledAt: '2026-11-15T03:30:00Z',
  }),
  overdue,
], teams, now)
assert.equal(
  selectNextScheduleEntry(unresolvedOverdue, now)?.match.id,
  overdue.id,
  'a playable overdue match must beat a more recent unresolved overdue match',
)

const onlyUnscheduled = buildScheduleEntries([
  match(60, {
    round: 1,
    slot: 0,
    teamAId: null,
    teamBId: null,
    sourceMatchAId: 98,
    sourceMatchBId: 99,
  }),
  match(61, { round: 2, slot: 0, teamAId: 3, teamBId: 4 }),
], teams, now)
assert.equal(
  selectNextScheduleEntry(onlyUnscheduled, now)?.match.id,
  61,
  'a playable unscheduled match must beat an unresolved bracket-order fallback',
)

const completedOnly = buildScheduleEntries([sourceA], teams, now)
assert.equal(selectNextScheduleEntry(completedOnly, now), null)
assert.throws(() => buildScheduleEntries([], [], Number.NaN), /valid timestamp/)
assert.throws(() => selectNextScheduleEntry([], new Date(Number.NaN)), /valid timestamp/)

console.log('schedule tests passed')

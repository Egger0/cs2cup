import assert from 'node:assert/strict'
import { serializeICalendar } from '../lib/icalendar.ts'

const generatedAt = new Date('2026-01-02T03:04:05Z')
const serialized = serializeICalendar({
  name: 'Autumn, Cup; Main',
  generatedAt,
  events: [
    {
      uid: 'match,1@example.test',
      startsAt: new Date('2026-11-14T16:30:00+08:00'),
      summary: 'Alpha, One vs Bravo; Two',
      description: 'First line\u2028Second\0 line\nBackslash \\ test',
      url: 'https://example.test/matches/1\r\n\0INJECTED:TRUE',
      status: 'TENTATIVE',
    },
  ],
})

assert.equal(
  serialized,
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CS2CUP//Tournament Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Autumn\\, Cup\\; Main',
    'BEGIN:VEVENT',
    'UID:match\\,1@example.test',
    'DTSTAMP:20260102T030405Z',
    'DTSTART:20261114T083000Z',
    'SUMMARY:Alpha\\, One vs Bravo\\; Two',
    'DESCRIPTION:First line\\nSecond line\\nBackslash \\\\ test',
    'URL:https://example.test/matches/1INJECTED:TRUE',
    'STATUS:TENTATIVE',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n'),
)
assert.equal(serialized.endsWith('\r\n'), true)
assert.equal(serialized.replaceAll('\r\n', '').includes('\n'), false)

const longName = '赛事日历'.repeat(30)
const folded = serializeICalendar({ name: longName, generatedAt, events: [] })
const physicalLines = folded.split('\r\n').filter(Boolean)
assert.equal(
  physicalLines.every(line => Buffer.byteLength(line, 'utf8') <= 75),
  true,
)
assert.match(folded, /X-WR-CALNAME:[^\r\n]+\r\n /)
assert.equal(folded.replace(/\r\n /g, '').includes(`X-WR-CALNAME:${longName}`), true)

for (const calendar of [
  { name: 'Invalid stamp', generatedAt: new Date(Number.NaN), events: [] },
  {
    name: 'Invalid start',
    generatedAt,
    events: [{ uid: 'bad', startsAt: new Date(Number.NaN), summary: 'Bad date' }],
  },
]) {
  assert.throws(() => serializeICalendar(calendar), /dates must be valid/)
}

console.log('iCalendar serializer tests passed')

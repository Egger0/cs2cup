export type ICalendarStatus = 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED'

export interface ICalendarEvent {
  uid: string
  startsAt: Date
  summary: string
  description?: string
  url?: string
  status?: ICalendarStatus
}

export interface ICalendar {
  name: string
  generatedAt: Date
  events: readonly ICalendarEvent[]
}

const encoder = new TextEncoder()

function escapeText(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|[\r\n\u2028\u2029]/gu, '\\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, '')
    .replace(/[,;]/g, character => `\\${character}`)
}

function utcDateTime(value: Date) {
  if (Number.isNaN(value.getTime())) throw new RangeError('iCalendar dates must be valid')
  return value
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

function utf8Prefix(value: string, byteLimit: number) {
  let bytes = 0
  let end = 0

  for (const character of value) {
    const size = encoder.encode(character).length
    if (bytes + size > byteLimit) break
    bytes += size
    end += character.length
  }

  return value.slice(0, end)
}

function foldLine(line: string) {
  const folded: string[] = []
  let remaining = line

  while (encoder.encode(remaining).length > (folded.length ? 74 : 75)) {
    const part = utf8Prefix(remaining, folded.length ? 74 : 75)
    folded.push(folded.length ? ` ${part}` : part)
    remaining = remaining.slice(part.length)
  }

  folded.push(folded.length ? ` ${remaining}` : remaining)
  return folded.join('\r\n')
}

function textProperty(name: string, value: string) {
  return `${name}:${escapeText(value)}`
}

function uriProperty(name: string, value: string) {
  return `${name}:${value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu, '')}`
}

export function serializeICalendar(calendar: ICalendar) {
  const stamp = utcDateTime(calendar.generatedAt)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CS2CUP//Tournament Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    textProperty('X-WR-CALNAME', calendar.name),
  ]

  for (const event of calendar.events) {
    lines.push(
      'BEGIN:VEVENT',
      textProperty('UID', event.uid),
      `DTSTAMP:${stamp}`,
      `DTSTART:${utcDateTime(event.startsAt)}`,
      textProperty('SUMMARY', event.summary),
    )
    if (event.description) lines.push(textProperty('DESCRIPTION', event.description))
    if (event.url) lines.push(uriProperty('URL', event.url))
    lines.push(`STATUS:${event.status ?? 'CONFIRMED'}`, 'END:VEVENT')
  }

  lines.push('END:VCALENDAR')
  return `${lines.map(foldLine).join('\r\n')}\r\n`
}

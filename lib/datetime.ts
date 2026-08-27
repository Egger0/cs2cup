export const SITE_TIME_ZONE = 'Asia/Shanghai'

export type DateTimeValue = string | number | Date

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/

const sitePartsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SITE_TIME_ZONE,
  calendar: 'gregory',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

const siteWeekdayFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: SITE_TIME_ZONE,
  weekday: 'short',
})

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function daysInMonth(year: number, month: number) {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function validDateTimeParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
) {
  return (
    year >= 1000 &&
    year <= 9999 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59
  )
}

function parseDateTimeValue(value: DateTimeValue): Date | null {
  if (value instanceof Date) {
    const timestamp = value.getTime()
    return Number.isFinite(timestamp) ? new Date(timestamp) : null
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) && !Number.isNaN(new Date(value).getTime())
      ? new Date(value)
      : null
  }

  const match = ISO_INSTANT.exec(value)
  if (!match) return null

  const [, rawYear, rawMonth, rawDay, rawHour, rawMinute, rawSecond, , rawOffsetHour, rawOffsetMinute] = match
  const year = Number(rawYear)
  const month = Number(rawMonth)
  const day = Number(rawDay)
  const hour = Number(rawHour)
  const minute = Number(rawMinute)
  const second = Number(rawSecond)
  const offsetHour = rawOffsetHour === undefined ? 0 : Number(rawOffsetHour)
  const offsetMinute = rawOffsetMinute === undefined ? 0 : Number(rawOffsetMinute)

  if (
    !validDateTimeParts(year, month, day, hour, minute, second) ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  ) {
    return null
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function isIsoInstant(value: unknown): value is string {
  return typeof value === 'string' && parseDateTimeValue(value) !== null
}

function siteParts(value: DateTimeValue) {
  const date = parseDateTimeValue(value)
  if (!date) return null

  const parts = new Map(
    sitePartsFormatter
      .formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  )
  const year = parts.get('year')
  const month = parts.get('month')
  const day = parts.get('day')
  const hour = parts.get('hour')
  const minute = parts.get('minute')
  if (!year || !month || !day || !hour || !minute) return null

  return { date, year, month, day, hour, minute }
}

export function dateTimeLocalToIso(value: string): string | null {
  const match = LOCAL_DATE_TIME.exec(value)
  if (!match) return null

  const [, rawYear, rawMonth, rawDay, rawHour, rawMinute] = match
  const year = Number(rawYear)
  const month = Number(rawMonth)
  const day = Number(rawDay)
  const hour = Number(rawHour)
  const minute = Number(rawMinute)
  if (!validDateTimeParts(year, month, day, hour, minute)) return null

  const target = Date.UTC(year, month - 1, day, hour, minute)
  let candidate = target
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = siteParts(candidate)
    if (!parts) return null
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    )
    const adjustment = target - represented
    candidate += adjustment
    if (adjustment === 0) break
  }

  const date = new Date(candidate)
  return isoToDateTimeLocal(date) === value ? date.toISOString() : null
}

export function isoToDateTimeLocal(value: DateTimeValue): string | null {
  const parts = siteParts(value)
  if (!parts) return null
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

export function siteDayKey(value: DateTimeValue): string | null {
  const parts = siteParts(value)
  if (!parts) return null
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function formatSiteDate(value: DateTimeValue): string | null {
  const parts = siteParts(value)
  if (!parts) return null
  const weekday = siteWeekdayFormatter.format(parts.date)
  return `${parts.year}年${Number(parts.month)}月${Number(parts.day)}日 · ${weekday}`
}

export function formatSiteTime(value: DateTimeValue): string | null {
  const parts = siteParts(value)
  if (!parts) return null
  return `${parts.hour}:${parts.minute}`
}

export function formatSiteDateTime(value: DateTimeValue): string | null {
  const date = formatSiteDate(value)
  const time = formatSiteTime(value)
  return date && time ? `${date} · ${time}` : null
}

export function formatSiteCompactDateTime(value: DateTimeValue): string | null {
  const parts = siteParts(value)
  if (!parts) return null
  return `${Number(parts.month)}月${Number(parts.day)}日 ${parts.hour}:${parts.minute}`
}

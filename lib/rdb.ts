import 'server-only'
import { cloudflareBindings } from './cloudflare-bindings'
import { splitFilter } from './rdb-filter'

type SelectionOptions = {
  filters?: Record<string, string>
  order?: string
  limit?: number
}

type PublicRelation =
  | 'club_member'
  | 'game'
  | 'guestbook_public'
  | 'match_map_public'
  | 'match_public'
  | 'photo_public'
  | 'player_public'
  | 'post'
  | 'site_setting'
  | 'team_public'
  | 'tournament_public'

export class RdbError extends Error {
  readonly status: number
  readonly table: string

  constructor(status: number, table: string, message: string) {
    super(`${table}: ${message}`)
    this.name = 'RdbError'
    this.status = status
    this.table = table
  }
}

const identifier = /^[a-z_]+$/

function name(value: string) {
  if (!identifier.test(value)) throw new TypeError('invalid SQL identifier')
  return value
}

function predicate(column: string, value: string, values: unknown[]) {
  const [operator, raw] = splitFilter(value)

  if (operator === 'eq' || operator === 'neq') {
    values.push(raw)
    return `${name(column)} ${operator === 'eq' ? '=' : '!='} ?`
  }

  if (operator === 'in') {
    const entries = raw
      .replace(/^\(|\)$/g, '')
      .split(',')
      .filter(Boolean)
    if (!entries.length) return '0'
    values.push(...entries)
    return `${name(column)} IN (${entries.map(() => '?').join(',')})`
  }

  if (operator === 'is' && raw === 'null') return `${name(column)} IS NULL`

  if (operator === 'ilike') {
    values.push(raw.replaceAll('*', '%'))
    return `LOWER(${name(column)}) LIKE LOWER(?)`
  }

  throw new TypeError(`unsupported filter operator: ${operator}`)
}

function where(filters: Record<string, string> | undefined, values: unknown[]) {
  if (!filters) return ''

  const clauses = Object.entries(filters)
    .filter(([column]) => column !== 'or')
    .map(([column, value]) => predicate(column, value, values))
  const disjunction =
    filters.or
      ?.replace(/^\(|\)$/g, '')
      .split(',')
      .filter(Boolean)
      .map(entry => {
        const [column, operator, ...rest] = entry.split('.')
        return predicate(column ?? '', `${operator ?? ''}.${rest.join('.')}`, values)
      }) ?? []

  if (disjunction.length) clauses.push(`(${disjunction.join(' OR ')})`)
  return clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
}

function ordering(order: string | undefined) {
  if (!order) return ''

  return ` ORDER BY ${order
    .split(',')
    .flatMap(part => {
      const [column = '', direction = 'asc', nulls] = part.split('.')
      const safeColumn = name(column)
      const sqlDirection = direction === 'desc' ? 'DESC' : 'ASC'
      if (nulls === 'nullslast') {
        return [`${safeColumn} IS NULL ASC`, `${safeColumn} ${sqlDirection}`]
      }
      if (nulls === 'nullsfirst') {
        return [`${safeColumn} IS NOT NULL ASC`, `${safeColumn} ${sqlDirection}`]
      }
      return `${safeColumn} ${sqlDirection}`
    })
    .join(', ')}`
}

function normalize<Row>(row: Row): Row {
  if (!row || typeof row !== 'object') return row
  const record = row as Record<string, unknown>

  for (const key of ['map_pool', 'rules', 'faqs']) {
    if (typeof record[key] === 'string') {
      try {
        record[key] = JSON.parse(record[key])
      } catch {
        record[key] = []
      }
    }
  }

  if (typeof record.game === 'string') {
    try {
      record.game = JSON.parse(record.game)
    } catch {
      record.game = null
    }
  }

  for (const key of ['active', 'is_official', 'is_substitute', 'played', 'pinned']) {
    if (typeof record[key] === 'number') record[key] = record[key] === 1
  }

  return row
}

async function rows<T>(table: string, options: SelectionOptions) {
  const values: unknown[] = []
  const source = name(table)
  const tournamentSource = source === 'tournament' || source === 'tournament_public'
  const select = tournamentSource
    ? "t.*, (SELECT json_object('slug', g.slug, 'name', g.name) FROM game g WHERE g.id = t.game_id) AS game"
    : '*'
  const from = tournamentSource ? `${source} t` : source
  const statement = `SELECT ${select} FROM ${from}${where(options.filters, values)}${ordering(options.order)}${options.limit === undefined ? '' : ` LIMIT ${Number(options.limit)}`}`

  try {
    return (
      await cloudflareBindings()
        .db.prepare(statement)
        .bind(...values)
        .all<T>()
    ).results.map(normalize)
  } catch (error) {
    throw new RdbError(503, table, error instanceof Error ? error.message : 'D1 request failed')
  }
}

export function selectPublicRows<Row>(table: PublicRelation, options: SelectionOptions = {}) {
  return rows<Row>(table, options)
}

export async function selectPublicRow<Row>(table: PublicRelation, options: SelectionOptions = {}) {
  return (await rows<Row>(table, { ...options, limit: 1 }))[0] ?? null
}

export function selectPrivateRows<Row>(table: string, options: SelectionOptions = {}) {
  return rows<Row>(table, options)
}

export async function selectPrivateRow<Row>(table: string, options: SelectionOptions = {}) {
  return (await rows<Row>(table, { ...options, limit: 1 }))[0] ?? null
}

function fieldValue(value: unknown) {
  if (Array.isArray(value) || (value && typeof value === 'object')) {
    return JSON.stringify(value)
  }
  return typeof value === 'boolean' ? Number(value) : value
}

function fields(values: Record<string, unknown>) {
  const keys = Object.keys(values).map(name)
  return { keys, values: keys.map(key => fieldValue(values[key])) }
}

export async function insertPrivateRows<Row>(table: string, values: unknown) {
  const record = values as Record<string, unknown>
  const data = fields(record)
  const sql = `INSERT INTO ${name(table)} (${data.keys.join(',')}) VALUES (${data.keys.map(() => '?').join(',')}) RETURNING *`
  return (
    await cloudflareBindings()
      .db.prepare(sql)
      .bind(...data.values)
      .all<Row>()
  ).results
}

export async function updatePrivateRows<Row>(
  table: string,
  values: unknown,
  options: SelectionOptions,
) {
  const record = values as Record<string, unknown>
  const data = fields(record)
  const params = [...data.values]
  const sql = `UPDATE ${name(table)} SET ${data.keys.map(key => `${key} = ?`).join(',')}${where(options.filters, params)} RETURNING *`
  return (
    await cloudflareBindings()
      .db.prepare(sql)
      .bind(...params)
      .all<Row>()
  ).results
}

export async function deletePrivateRows(table: string, options: SelectionOptions) {
  const params: unknown[] = []
  await cloudflareBindings()
    .db.prepare(`DELETE FROM ${name(table)}${where(options.filters, params)}`)
    .bind(...params)
    .run()
}

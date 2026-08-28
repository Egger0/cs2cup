import 'server-only'
import {
  rdbAuthorizationHeader,
  resolveRdbEndpoint,
} from './rdb-endpoint.ts'
import type { RdbCredential } from './rdb-endpoint.ts'
import {
  publicDataFetchOptions,
  type PublicDataCache,
} from './rdb-cache-policy.ts'

type Credential = RdbCredential

interface SelectionOptions {
  select?: string
  filters?: Record<string, string>
  order?: string
  limit?: number
}

export interface PublicQueryOptions extends SelectionOptions {
  select: string
  cache: PublicDataCache
}

export type PrivateQueryOptions = SelectionOptions

export const PUBLIC_RELATIONS = [
  'club_member',
  'game',
  'match',
  'match_map_public',
  'photo_public',
  'player_public',
  'post',
  'site_setting',
  'team_public',
  'tournament',
] as const

export type PublicRelation = (typeof PUBLIC_RELATIONS)[number]
export type PublicFunction = 'registration_status'

const publicRelations = new Set<string>(PUBLIC_RELATIONS)

function assertPublicRelation(table: string): asserts table is PublicRelation {
  if (!publicRelations.has(table)) {
    throw new TypeError(`${table} is not an approved public relation`)
  }
}

function assertPublicFunction(name: string): asserts name is PublicFunction {
  if (name !== 'registration_status') {
    throw new TypeError(`${name} is not an approved public function`)
  }
}

function assertPublicProjection(select: string) {
  if (select.trim().length === 0 || select.includes('*')) {
    throw new TypeError('public reads require an explicit projection without wildcards')
  }
}

export class RdbError extends Error {
  readonly status: number
  readonly table: string

  constructor(
    status: number,
    table: string,
    message: string,
  ) {
    super(`${table}: ${message}`)
    this.status = status
    this.table = table
    this.name = 'RdbError'
  }
}

function search({ select, filters, order, limit }: SelectionOptions) {
  const params = new URLSearchParams()
  params.set('select', select ?? '*')
  for (const [column, predicate] of Object.entries(filters ?? {})) {
    params.append(column, predicate)
  }
  if (order) params.set('order', order)
  if (limit !== undefined) params.set('limit', String(limit))
  return params
}

async function request<T>(
  method: string,
  table: string,
  options: SelectionOptions,
  credential: Credential,
  cache: PublicDataCache | undefined,
  body?: unknown,
): Promise<T> {
  const endpoint = resolveRdbEndpoint(credential)
  const url = `${endpoint.baseUrl}/${table}?${search(options)}`

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...rdbAuthorizationHeader(endpoint, credential),
        'Content-Type': 'application/json',
        ...(body !== undefined ? { Prefer: 'return=representation' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      ...(method === 'GET' && credential === 'anon' && cache
        ? publicDataFetchOptions(cache)
        : { cache: 'no-store' as const }),
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'network request failed'
    throw new RdbError(503, table, `request to ${new URL(url).origin} failed: ${detail}`)
  }

  if (!response.ok) {
    throw new RdbError(response.status, table, await response.text())
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}

export function selectPublicRows<Row>(table: PublicRelation, options: PublicQueryOptions) {
  assertPublicRelation(table)
  assertPublicProjection(options.select)
  return request<Row[]>('GET', table, options, 'anon', options.cache)
}

export async function selectPublicRow<Row>(table: PublicRelation, options: PublicQueryOptions) {
  const rows = await selectPublicRows<Row>(table, { ...options, limit: 1 })
  return rows[0] ?? null
}

export function selectPrivateRows<Row>(table: string, options: PrivateQueryOptions = {}) {
  return request<Row[]>('GET', table, options, 'admin', undefined)
}

export async function selectPrivateRow<Row>(table: string, options: PrivateQueryOptions = {}) {
  const rows = await selectPrivateRows<Row>(table, { ...options, limit: 1 })
  return rows[0] ?? null
}

export function insertPrivateRows<Row>(
  table: string,
  values: unknown,
  options: PrivateQueryOptions = {},
) {
  return request<Row[]>('POST', table, options, 'admin', undefined, values)
}

export function updatePrivateRows<Row>(
  table: string,
  values: unknown,
  options: PrivateQueryOptions,
) {
  return request<Row[]>('PATCH', table, options, 'admin', undefined, values)
}

export function deletePrivateRows(table: string, options: PrivateQueryOptions) {
  return request<void>('DELETE', table, options, 'admin', undefined)
}

async function callFunction<T>(name: string, args: unknown, credential: Credential) {
  const endpoint = resolveRdbEndpoint(credential)
  let response: Response
  try {
    response = await fetch(`${endpoint.baseUrl}/rpc/${name}`, {
      method: 'POST',
      headers: {
        ...rdbAuthorizationHeader(endpoint, credential),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      cache: 'no-store',
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'network request failed'
    throw new RdbError(503, name, `request to ${new URL(endpoint.baseUrl).origin} failed: ${detail}`)
  }

  if (!response.ok) throw new RdbError(response.status, name, await response.text())
  return (await response.json()) as T
}

export function callPublicFunction<T>(name: PublicFunction, args: unknown) {
  assertPublicFunction(name)
  return callFunction<T>(name, args, 'anon')
}

export function callPrivateFunction<T>(name: string, args: unknown) {
  return callFunction<T>(name, args, 'admin')
}

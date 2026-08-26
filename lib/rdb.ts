import 'server-only'

type Credential = 'anon' | 'admin'

export interface QueryOptions {
  select?: string
  filters?: Record<string, string>
  order?: string
  limit?: number
  single?: boolean
  credential?: Credential
  tags?: string[]
  revalidate?: number | false
}

export class RdbError extends Error {
  constructor(
    readonly status: number,
    readonly table: string,
    message: string,
  ) {
    super(`${table}: ${message}`)
    this.name = 'RdbError'
  }
}

function endpoint() {
  const env = process.env.CLOUDBASE_ENV_ID
  if (!env) throw new Error('CLOUDBASE_ENV_ID is not set')
  return `https://${env}.api.tcloudbasegateway.com/v1/rdb/rest`
}

function keyFor(credential: Credential) {
  const key =
    credential === 'admin'
      ? process.env.CLOUDBASE_ADMIN_KEY
      : process.env.CLOUDBASE_ANON_KEY
  if (!key) throw new Error(`CLOUDBASE_${credential.toUpperCase()}_KEY is not set`)
  return key
}

function search({ select, filters, order, limit }: QueryOptions) {
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
  options: QueryOptions,
  body?: unknown,
): Promise<T> {
  const credential = options.credential ?? 'anon'
  const url = `${endpoint()}/${table}?${search(options)}`

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${keyFor(credential)}`,
      'Content-Type': 'application/json',
      ...(body !== undefined ? { Prefer: 'return=representation' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    next:
      method === 'GET'
        ? { tags: options.tags, revalidate: options.revalidate }
        : undefined,
    cache: method === 'GET' ? undefined : 'no-store',
  })

  if (!response.ok) {
    throw new RdbError(response.status, table, await response.text())
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}

export function selectRows<Row>(table: string, options: QueryOptions = {}) {
  return request<Row[]>('GET', table, options)
}

export async function selectRow<Row>(table: string, options: QueryOptions = {}) {
  const rows = await selectRows<Row>(table, { ...options, limit: 1 })
  return rows[0] ?? null
}

export function insertRows<Row>(table: string, values: unknown, options: QueryOptions = {}) {
  return request<Row[]>('POST', table, options, values)
}

export function updateRows<Row>(table: string, values: unknown, options: QueryOptions) {
  return request<Row[]>('PATCH', table, options, values)
}

export function deleteRows(table: string, options: QueryOptions) {
  return request<void>('DELETE', table, options)
}

export function callFunction<T>(name: string, args: unknown, credential: Credential = 'anon') {
  return fetch(`${endpoint()}/rpc/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${keyFor(credential)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
    cache: 'no-store',
  }).then(async response => {
    if (!response.ok) throw new RdbError(response.status, name, await response.text())
    return (await response.json()) as T
  })
}

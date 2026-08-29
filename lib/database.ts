import 'server-only'

import { getCloudflareContext } from '@opennextjs/cloudflare'
import postgres from 'postgres'
import { cache } from 'react'

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER)
const POSTGRES_CODE = /^[0-9A-Z]{5}$/
const NETWORK_CODE = /^E[A-Z0-9_]{2,31}$/

interface HyperdriveBinding {
  connectionString: string
}

interface DatabaseEnvironment {
  CS2CUP_DATABASE?: HyperdriveBinding
}

export type DatabaseClient = ReturnType<typeof postgres>

export class DatabaseConfigurationError extends Error {
  constructor() {
    super('Database connection is not configured')
    this.name = 'DatabaseConfigurationError'
  }
}

export class DatabaseError extends Error {
  readonly operation: string
  readonly code: string | null
  readonly retryable: boolean

  constructor(operation: string, code: string | null, retryable: boolean) {
    super(`Database operation failed: ${operation}`)
    this.name = 'DatabaseError'
    this.operation = operation
    this.code = code
    this.retryable = retryable
  }
}

function cloudflareEnvironment(): DatabaseEnvironment | null {
  try {
    return getCloudflareContext().env as DatabaseEnvironment
  } catch {
    return null
  }
}

type DatabaseTarget =
  | { kind: 'hyperdrive'; connectionString: string }
  | { kind: 'standalone'; connectionString: string }

function databaseTarget(): DatabaseTarget {
  const environment = cloudflareEnvironment()
  if (environment) {
    const bindingValue = environment.CS2CUP_DATABASE?.connectionString
    if (typeof bindingValue !== 'string' || bindingValue.length === 0) {
      throw new DatabaseConfigurationError()
    }
    return { kind: 'hyperdrive', connectionString: bindingValue }
  }

  const value = process.env.DATABASE_URL
  if (typeof value !== 'string' || value.length === 0) {
    throw new DatabaseConfigurationError()
  }
  return { kind: 'standalone', connectionString: value }
}

function createDatabaseClient(connectionString: string): DatabaseClient {
  return postgres(connectionString, {
    max: 5,
    fetch_types: false,
    connect_timeout: 5,
    idle_timeout: 20,
    max_lifetime: 60,
    connection: {
      application_name: 'cs2cup',
      statement_timeout: 10_000,
      lock_timeout: 5_000,
    },
  })
}

let standaloneClient: DatabaseClient | undefined
let standaloneConnectionString: string | undefined

function requestDatabase() {
  const target = databaseTarget()
  if (target.kind === 'hyperdrive') {
    return createDatabaseClient(target.connectionString)
  }

  // A long-running Node standalone process owns its pool across requests.
  // This branch is unreachable in Workers because a missing binding fails
  // closed above instead of falling back to DATABASE_URL.
  if (!standaloneClient || standaloneConnectionString !== target.connectionString) {
    standaloneClient = createDatabaseClient(target.connectionString)
    standaloneConnectionString = target.connectionString
  }
  return standaloneClient
}

// React clears the Hyperdrive client at the request boundary. Never hoist that
// client into isolate-global state: Workers forbid cross-request I/O reuse.
export const database = cache(requestDatabase)

function errorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return null
  const code = (error as { code?: unknown }).code
  if (typeof code !== 'string') return null
  return POSTGRES_CODE.test(code) || NETWORK_CODE.test(code) ? code : null
}

function retryable(code: string | null) {
  return code === null ||
    code === '40001' ||
    code === '40P01' ||
    code === '55P03' ||
    code === '57014' ||
    code === '57P01' ||
    code.startsWith('08') ||
    code.startsWith('E')
}

export async function databaseOperation<Result>(
  operation: string,
  work: () => Promise<Result>,
): Promise<Result> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof DatabaseConfigurationError || error instanceof DatabaseError) {
      throw error
    }
    const code = errorCode(error)
    throw new DatabaseError(operation, code, retryable(code))
  }
}

export function safeDatabaseInteger(value: unknown, field = 'integer') {
  let parsed: bigint
  if (typeof value === 'bigint') {
    parsed = value
  } else if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value
  } else if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    try {
      parsed = BigInt(value)
    } catch {
      throw new DatabaseError(`decode:${field}`, null, false)
    }
  } else {
    throw new DatabaseError(`decode:${field}`, null, false)
  }

  if (parsed < MIN_SAFE_BIGINT || parsed > MAX_SAFE_BIGINT) {
    throw new DatabaseError(`decode:${field}`, null, false)
  }
  return Number(parsed)
}

export function isoDatabaseTimestamp(value: unknown, field = 'timestamp') {
  const parsed = value instanceof Date
    ? value
    : typeof value === 'string'
      ? new Date(value)
      : null
  if (!parsed || !Number.isFinite(parsed.getTime())) {
    throw new DatabaseError(`decode:${field}`, null, false)
  }
  return parsed.toISOString()
}

export function nullableIsoDatabaseTimestamp(value: unknown, field = 'timestamp') {
  return value === null ? null : isoDatabaseTimestamp(value, field)
}

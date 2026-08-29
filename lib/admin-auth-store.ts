import 'server-only'

import { bytesToHex } from './admin-auth-crypto'
import { database, databaseOperation } from './database'

function byteaHex(value: Uint8Array) {
  return bytesToHex(value)
}

export function beginLocalAdminLogin(
  accountFingerprint: Uint8Array,
  networkFingerprint: Uint8Array,
  username: string,
) {
  return databaseOperation('admin-auth:begin-login', async () => {
    const sql = database()
    const rows = await sql<{ result: unknown }[]>`
      select public.begin_local_admin_login(
        pg_catalog.decode(${byteaHex(accountFingerprint)}, 'hex'),
        pg_catalog.decode(${byteaHex(networkFingerprint)}, 'hex'),
        ${username}::text
      ) as result
    `
    return rows[0]?.result
  })
}

export function createLocalAdminSession(
  principalId: string,
  credentialVersion: number,
  tokenHash: Uint8Array,
  accountFingerprint: Uint8Array,
  requestId: string,
) {
  return databaseOperation('admin-auth:create-session', async () => {
    const sql = database()
    const rows = await sql<{ result: unknown }[]>`
      select public.create_local_admin_session(
        ${principalId}::uuid,
        ${credentialVersion}::bigint,
        pg_catalog.decode(${byteaHex(tokenHash)}, 'hex'),
        pg_catalog.decode(${byteaHex(accountFingerprint)}, 'hex'),
        ${requestId}::uuid
      ) as result
    `
    return rows[0]?.result
  })
}

export function useLocalAdminSession(tokenHash: Uint8Array, requestId: string) {
  return databaseOperation('admin-auth:use-session', async () => {
    const sql = database()
    const rows = await sql<{ result: unknown }[]>`
      select public.use_local_admin_session(
        pg_catalog.decode(${byteaHex(tokenHash)}, 'hex'),
        ${requestId}::uuid
      ) as result
    `
    return rows[0]?.result
  })
}

export function endLocalAdminSession(tokenHash: Uint8Array, requestId: string) {
  return databaseOperation('admin-auth:end-session', async () => {
    const sql = database()
    const rows = await sql<{ result: unknown }[]>`
      select public.end_local_admin_session(
        pg_catalog.decode(${byteaHex(tokenHash)}, 'hex'),
        ${requestId}::uuid
      ) as result
    `
    return rows[0]?.result
  })
}

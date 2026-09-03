import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { registerHooks } from 'node:module'

import { createMigratedDatabase } from './sqlite-fixture.mjs'

const source = path => new URL(path, import.meta.url).href
const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
const bindingsModule = dataModule(`
  export function cloudflareBindings() { return globalThis.__legacySessionBindings }
`)
const cookiesModule = dataModule(`
  export async function cookies() { return globalThis.__legacySessionCookieStore }
  export async function headers() { return new Headers() }
`)
const navigationModule = dataModule(`
  export function redirect(path) { throw Object.assign(new Error('redirect'), { kind: 'redirect', path }) }
  export function notFound() { throw Object.assign(new Error('not-found'), { kind: 'not-found' }) }
`)
const identityKernelModule = dataModule(`
  export async function getAuthContext() { return { kind: 'anonymous' } }
  export async function authorize() { return { ok: false, reason: 'anonymous' } }
`)

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') {
      return { url: 'data:text/javascript,export {}', shortCircuit: true }
    }
    if (specifier === 'next/headers') return { url: cookiesModule, shortCircuit: true }
    if (specifier === 'next/navigation') return { url: navigationModule, shortCircuit: true }
    if (specifier === 'next/server') return nextResolve('next/server.js', context)
    if (specifier === './cloudflare-bindings' || specifier === '@/lib/cloudflare-bindings') {
      return { url: bindingsModule, shortCircuit: true }
    }
    if (specifier === './identity/kernel') {
      return { url: identityKernelModule, shortCircuit: true }
    }
    if (specifier.startsWith('@/')) {
      return nextResolve(source(`../${specifier.slice(2)}.ts`), context)
    }
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith('.') || /\.[a-z]+$/i.test(specifier)) throw error
      return nextResolve(`${specifier}.ts`, context)
    }
  },
})

class D1Statement {
  constructor(owner, sql, parameters = []) {
    this.owner = owner
    this.sql = sql
    this.parameters = parameters
  }

  bind(...parameters) {
    return new D1Statement(this.owner, this.sql, parameters)
  }

  async first() {
    return this.owner.database.prepare(this.sql).get(...this.parameters) ?? null
  }

  async run() {
    return this.owner.database.prepare(this.sql).run(...this.parameters)
  }
}

class D1Database {
  constructor(database) {
    this.database = database
  }

  prepare(sql) {
    return new D1Statement(this, sql)
  }

  async batch(statements) {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      this.database.exec('COMMIT')
      return results
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }
}

const ADMIN_COOKIE = 'cs2cup_admin'
const PARTICIPANT_COOKIE = '__Host-cs2cup_participant'
const ADMIN_TOKEN = 'admin-session-token'
const PARTICIPANT_TOKEN = 'P'.repeat(43)
const PRINCIPAL = `p_${'A'.repeat(43)}`
const CREDENTIAL = 'legacy-containment-credential'
const now = Date.now()
const hash = value => createHash('sha256').update(value).digest('hex')
const database = await createMigratedDatabase()
const previousSiteUrl = process.env.NEXT_PUBLIC_SITE_URL
process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000'

function insertSessions() {
  database
    .prepare('INSERT INTO admin_session (token_hash, admin_id, expires_at) VALUES (?, 1, ?)')
    .run(hash(ADMIN_TOKEN), now + 60_000)
  database
    .prepare(
      `INSERT INTO participant_session
        (token_hash, principal_id, credential_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(hash(PARTICIPANT_TOKEN), PRINCIPAL, CREDENTIAL, now - 1_000, now + 60_000)
}

function sessionCount(table) {
  return database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count
}

try {
  database.exec(`
    INSERT INTO admin_account (id, username, password_salt, password_hash)
    VALUES (1, 'owner', 'salt', 'hash');
  `)
  database
    .prepare('INSERT INTO participant_principal (id, webauthn_user_handle) VALUES (?, ?)')
    .run(PRINCIPAL, 'H'.repeat(43))
  database
    .prepare(
      `INSERT INTO participant_passkey_credential
        (credential_id, principal_id, public_key, device_type, created_at)
       VALUES (?, ?, ?, 'multiDevice', ?)`,
    )
    .run(CREDENTIAL, PRINCIPAL, 'K'.repeat(8), now - 2_000)
  insertSessions()

  const clearedServerActionCookies = []
  const cookieValues = {
    [ADMIN_COOKIE]: ADMIN_TOKEN,
    [PARTICIPANT_COOKIE]: PARTICIPANT_TOKEN,
  }
  globalThis.__legacySessionBindings = { db: new D1Database(database), media: {} }
  globalThis.__legacySessionCookieStore = {
    get(name) {
      const value = cookieValues[name]
      return value ? { value } : undefined
    },
    set(name, value, options) {
      if (value === '' && options?.maxAge === 0) {
        clearedServerActionCookies.push({ name, options })
        delete cookieValues[name]
      } else {
        cookieValues[name] = value
      }
    },
  }

  const auth = await import('../lib/auth.ts?legacy-session-containment')
  const participantAuth = await import('../lib/participant-auth.ts')

  assert.equal(
    await participantAuth.getCurrentParticipant(),
    null,
    'participant surfaces must reject a second authenticated admin subject',
  )
  await assert.rejects(
    () => participantAuth.requireParticipant(),
    error => error.kind === 'redirect' && error.path === '/login?reason=conflict',
  )
  assert.equal(
    await auth.getCurrentPlatformOwner(),
    null,
    'admin surfaces must reject a second authenticated participant subject',
  )
  await assert.rejects(
    () => auth.requireAdmin(),
    error => error.kind === 'redirect' && error.path === '/login?reason=conflict&reauth=admin',
  )

  await auth.endLegacySessions()
  assert.equal(sessionCount('admin_session'), 0)
  assert.equal(sessionCount('participant_session'), 0)
  assert.deepEqual(
    new Set(clearedServerActionCookies.map(cookie => cookie.name)),
    new Set([ADMIN_COOKIE, PARTICIPANT_COOKIE]),
  )
  assert.equal(
    clearedServerActionCookies.every(cookie =>
      cookie.name === PARTICIPANT_COOKIE
        ? cookie.options.secure === true && cookie.options.path === '/'
        : cookie.options.secure === true,
    ),
    true,
    'prefixed cookies must be cleared with their original security attributes',
  )

  cookieValues[ADMIN_COOKIE] = ADMIN_TOKEN
  cookieValues[PARTICIPANT_COOKIE] = PARTICIPANT_TOKEN
  database
    .prepare(
      `INSERT INTO participant_session
        (token_hash, principal_id, credential_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(hash(PARTICIPANT_TOKEN), PRINCIPAL, CREDENTIAL, now - 1_000, now + 60_000)
  const participantWithStaleAdminCookie = await import('../lib/participant-auth.ts?stale-admin')
  assert.equal(
    (await participantWithStaleAdminCookie.getCurrentParticipant())?.principalId,
    PRINCIPAL,
    'a stale cookie without an authenticated second subject must not lock the user out',
  )
  database.prepare('DELETE FROM participant_session').run()

  const { NextRequest } = await import('next/server')
  cookieValues[ADMIN_COOKIE] = ADMIN_TOKEN
  cookieValues[PARTICIPANT_COOKIE] = PARTICIPANT_TOKEN
  insertSessions()
  const { DELETE } = await import('../app/api/participant/session/route.ts')
  const cookieHeader = `${PARTICIPANT_COOKIE}=${PARTICIPANT_TOKEN}; ${ADMIN_COOKIE}=${ADMIN_TOKEN}`
  const { POST: attachEntry } = await import('../app/api/participant/entries/attach/route.ts')
  const conflictingMutation = await attachEntry(
    new NextRequest('http://localhost:3000/api/participant/entries/attach', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader,
        Origin: 'http://localhost:3000',
        'Sec-Fetch-Site': 'same-origin',
      },
      body: JSON.stringify({
        slug: 'not-read-before-conflict-rejection',
        managementToken: 'M'.repeat(43),
      }),
    }),
  )
  assert.equal(conflictingMutation.status, 409)
  assert.match(await conflictingMutation.text(), /旧管理员会话/)
  assert.equal(sessionCount('admin_session'), 1)
  assert.equal(sessionCount('participant_session'), 1)

  const crossOriginResponse = await DELETE(
    new NextRequest('http://localhost:3000/api/participant/session', {
      method: 'DELETE',
      headers: {
        Cookie: cookieHeader,
        Origin: 'https://attacker.example',
        'Sec-Fetch-Site': 'cross-site',
      },
    }),
  )
  assert.equal(crossOriginResponse.status, 403)
  assert.equal(sessionCount('admin_session'), 1)
  assert.equal(sessionCount('participant_session'), 1)

  const response = await DELETE(
    new NextRequest('http://localhost:3000/api/participant/session', {
      method: 'DELETE',
      headers: {
        Cookie: cookieHeader,
        Origin: 'http://localhost:3000',
        'Sec-Fetch-Site': 'same-origin',
      },
    }),
  )

  assert.equal(response.status, 204)
  assert.equal(sessionCount('admin_session'), 0)
  assert.equal(sessionCount('participant_session'), 0)
  const clearedCookies = response.headers.getSetCookie().join('\n')
  assert.match(clearedCookies, new RegExp(`${ADMIN_COOKIE}=;`))
  assert.match(clearedCookies, new RegExp(`${PARTICIPANT_COOKIE}=;`))
  assert.equal((clearedCookies.match(/Max-Age=0/g) ?? []).length, 2)

  console.log('legacy dual-session containment tests passed')
} finally {
  delete globalThis.__legacySessionBindings
  delete globalThis.__legacySessionCookieStore
  if (previousSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
  else process.env.NEXT_PUBLIC_SITE_URL = previousSiteUrl
  database.close()
}

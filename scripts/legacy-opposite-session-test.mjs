import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { registerHooks } from 'node:module'

import { createMigratedDatabase } from './sqlite-fixture.mjs'

const source = path => new URL(path, import.meta.url).href
const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
const bindingsModule = dataModule(`
  export function cloudflareBindings() { return globalThis.__oppositeSessionBindings }
`)
const cookiesModule = dataModule(`
  export async function cookies() { return globalThis.__oppositeSessionCookieStore }
  export async function headers() { return new Headers() }
`)
const navigationModule = dataModule(`
  export function redirect(path) { throw Object.assign(new Error('redirect'), { kind: 'redirect', path }) }
  export function notFound() { throw Object.assign(new Error('not-found'), { kind: 'not-found' }) }
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
const ADMIN_TOKEN = 'A'.repeat(43)
const PARTICIPANT_TOKEN = 'P'.repeat(43)
const PRINCIPAL = `p_${'Q'.repeat(43)}`
const CREDENTIAL = 'legacy-opposite-session-credential'
const now = Date.now()
const hash = value => createHash('sha256').update(value).digest('hex')
const count = (database, table) =>
  database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count

const database = await createMigratedDatabase()
const previousSiteUrl = process.env.NEXT_PUBLIC_SITE_URL
process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000'

try {
  database
    .prepare(
      "INSERT INTO admin_account (id, username, password_salt, password_hash) VALUES (1, 'owner', 'salt', ?)",
    )
    .run('0'.repeat(64))
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

  globalThis.__oppositeSessionBindings = { db: new D1Database(database), media: {} }
  globalThis.__oppositeSessionCookieStore = { get() {}, set() {} }
  const { NextRequest } = await import('next/server')
  const sameOriginHeaders = {
    Origin: 'http://localhost:3000',
    'Sec-Fetch-Site': 'same-origin',
  }
  const auth = await import('../lib/auth.ts?opposite-session')

  database
    .prepare('INSERT INTO admin_session (token_hash, admin_id, expires_at) VALUES (?, 1, ?)')
    .run(hash(ADMIN_TOKEN), now + 60_000)
  const challengeCount = count(database, 'participant_webauthn_challenge')
  const { POST: beginClaim } =
    await import('../app/api/participant/passkeys/claim/options/route.ts')
  const blockedClaim = await beginClaim(
    new NextRequest('http://localhost:3000/api/participant/passkeys/claim/options', {
      method: 'POST',
      headers: {
        ...sameOriginHeaders,
        'Content-Type': 'application/json',
        Cookie: `${ADMIN_COOKIE}=${ADMIN_TOKEN}`,
      },
      body: JSON.stringify({ slug: 'must-not-be-read', token: 'M'.repeat(43) }),
    }),
  )
  assert.equal(blockedClaim.status, 409)
  assert.equal(count(database, 'participant_webauthn_challenge'), challengeCount)
  database.prepare('DELETE FROM admin_session').run()

  database
    .prepare(
      `INSERT INTO participant_session
        (token_hash, principal_id, credential_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(hash(PARTICIPANT_TOKEN), PRINCIPAL, CREDENTIAL, now - 1_000, now + 60_000)
  const { POST: createAdminLogin } = await import('../app/admin/session/route.ts')
  const blockedAdmin = await createAdminLogin(
    new NextRequest('http://localhost:3000/admin/session', {
      method: 'POST',
      headers: {
        ...sameOriginHeaders,
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: `${PARTICIPANT_COOKIE}=${PARTICIPANT_TOKEN}`,
      },
      body: new URLSearchParams({ username: 'owner', password: 'not-read' }),
    }),
  )
  assert.equal(blockedAdmin.status, 303)
  assert.match(blockedAdmin.headers.get('location') ?? '', /reason=conflict/)
  assert.equal(count(database, 'admin_session'), 0)

  await assert.rejects(
    () =>
      auth.createAdminSession(
        'owner',
        { bucketStart: now, fingerprint: `v1:${'f'.repeat(64)}` },
        hash(PARTICIPANT_TOKEN),
      ),
    error => error instanceof auth.LegacySessionConflictError,
  )
  assert.equal(count(database, 'admin_session'), 0)
  assert.equal(count(database, 'admin_session WHERE token_hash IS NULL'), 0)

  console.log('legacy opposite-session and browser-slot tests passed')
} finally {
  delete globalThis.__oppositeSessionBindings
  delete globalThis.__oppositeSessionCookieStore
  if (previousSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
  else process.env.NEXT_PUBLIC_SITE_URL = previousSiteUrl
  database.close()
}

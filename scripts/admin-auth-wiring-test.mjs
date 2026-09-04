import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { registerHooks } from 'node:module'

import { createMigratedDatabase } from './sqlite-fixture.mjs'

const source = path => new URL(path, import.meta.url).href
const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
const bindingsModule = dataModule(`
  export function cloudflareBindings() { return globalThis.__adminAuthBindings }
`)
const cookiesModule = dataModule(`
  export async function cookies() { return globalThis.__adminAuthCookies }
`)
const navigationModule = dataModule(`
  function interrupt(kind, path) {
    const error = new Error(kind)
    error.kind = kind
    error.path = path
    throw error
  }
  export function redirect(path) { interrupt('redirect', path) }
  export function notFound() { interrupt('not-found') }
`)
const identityKernelModule = dataModule(`
  export async function getAuthContext() {
    return globalThis.__adminUnifiedContext ?? { kind: 'anonymous' }
  }
  export async function authorize() {
    return globalThis.__adminUnifiedDecision ?? { ok: false, reason: 'forbidden' }
  }
`)
const mediaAuthModule = dataModule(`
  export async function getCurrentPlatformOwner() {
    return globalThis.__mediaPlatformOwner
  }
  export async function getCurrentUnifiedPlatformOwner() {
    return globalThis.__mediaUnifiedPlatformOwner
  }
`)
const rdbModule = dataModule(`
  export async function selectPublicRow() {
    return globalThis.__mediaPublished ? { id: 1 } : null
  }
  export async function selectPrivateRow() {
    return globalThis.__mediaPrivate ? { id: 1 } : null
  }
`)
const storageModule = dataModule(`
  export async function getObject() {
    globalThis.__mediaReads += 1
    return { body: new Uint8Array([1, 2, 3]), contentType: 'image/png' }
  }
`)

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') {
      return { url: 'data:text/javascript,export {}', shortCircuit: true }
    }
    if (specifier === 'next/headers') return { url: cookiesModule, shortCircuit: true }
    if (specifier === 'next/navigation') return { url: navigationModule, shortCircuit: true }
    if (specifier === './authorization') {
      return { url: source('../lib/authorization.ts'), shortCircuit: true }
    }
    if (specifier === './cloudflare-bindings') {
      return { url: bindingsModule, shortCircuit: true }
    }
    if (specifier === './identity/kernel') {
      return { url: identityKernelModule, shortCircuit: true }
    }
    if (specifier === '@/lib/auth') return { url: mediaAuthModule, shortCircuit: true }
    if (specifier === '@/lib/http-cache') {
      return { url: source('../lib/http-cache.ts'), shortCircuit: true }
    }
    if (specifier === '@/lib/rdb') return { url: rdbModule, shortCircuit: true }
    if (specifier === '@/lib/storage') return { url: storageModule, shortCircuit: true }
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith('.') || /\.[a-z]+$/i.test(specifier)) throw error
      return nextResolve(`${specifier}.ts`, context)
    }
  },
})

class D1Statement {
  constructor(database, sql, parameters = []) {
    this.database = database
    this.sql = sql
    this.parameters = parameters
  }

  bind(...parameters) {
    return new D1Statement(this.database, this.sql, parameters)
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.parameters) ?? null
  }
}

class D1Database {
  constructor(database) {
    this.database = database
  }

  prepare(sql) {
    return new D1Statement(this.database, sql)
  }
}

const database = await createMigratedDatabase()
const token = 'admin-auth-wiring-token'
const tokenHash = createHash('sha256').update(token).digest('hex')
globalThis.__adminAuthBindings = { db: new D1Database(database), media: {} }
globalThis.__adminAuthCookies = {
  get(name) {
    return name === 'cs2cup_admin' && globalThis.__adminAuthToken
      ? { value: globalThis.__adminAuthToken }
      : undefined
  },
}
globalThis.__adminUnifiedContext = { kind: 'anonymous' }
globalThis.__adminUnifiedDecision = { ok: false, reason: 'forbidden' }

async function authModule(label) {
  return import(new URL(`../lib/auth.ts?${label}`, import.meta.url))
}

try {
  database.exec(`
    INSERT INTO admin_account (id, username, password_salt, password_hash)
    VALUES (1, 'owner', 'salt', 'hash');
    INSERT INTO admin_session (token_hash, admin_id, expires_at)
    VALUES ('${tokenHash}', 1, ${Date.now() + 60_000});
  `)
  globalThis.__adminAuthToken = token

  globalThis.__adminUnifiedContext = {
    kind: 'authenticated',
    account: {
      id: 'U'.repeat(43),
      displayName: 'Unified Owner',
      verificationState: 'legacy_unverified',
    },
    session: { id: 'S'.repeat(43) },
  }
  globalThis.__adminUnifiedDecision = {
    ok: true,
    accountId: 'U'.repeat(43),
    capability: 'platform.configure',
    resource: { kind: 'platform' },
    assurance: 'recent',
  }
  const unified = await authModule('unified')
  assert.deepEqual(await unified.getCurrentUnifiedPlatformOwner(), {
    accountId: 'U'.repeat(43),
    uid: 'Unified Owner',
  })
  assert.deepEqual(await unified.requireAdmin(), {
    kind: 'unified',
    accountId: 'U'.repeat(43),
    uid: 'Unified Owner',
  })

  globalThis.__adminUnifiedContext = { kind: 'anonymous' }
  globalThis.__adminUnifiedDecision = { ok: false, reason: 'forbidden' }
  const active = await authModule('active')
  assert.deepEqual(await active.getCurrentPlatformOwner(), { adminId: 1, uid: 'owner' })
  await assert.rejects(
    () => active.requireAdmin(),
    error => error.kind === 'redirect' && error.path === '/admin/bootstrap',
  )

  database.exec(`
    SAVEPOINT mapped_admin_session;
    INSERT INTO identity_account
      (id, webauthn_user_handle, display_name, status, verification_state, created_at, updated_at)
    VALUES ('${'M'.repeat(43)}', '${'H'.repeat(43)}', 'Migrated owner',
            'active', 'verified', 1, 1);
    INSERT INTO identity_legacy_subject_map
      (subject_type, subject_id, account_id, source_revision, source_snapshot_hash,
       migration_version, mapped_at)
    VALUES ('admin_account', '1', '${'M'.repeat(43)}', 0, '${'a'.repeat(64)}', 1, 1);
  `)
  const mapped = await authModule('mapped')
  assert.equal(await mapped.getCurrentPlatformOwner(), null)
  await assert.rejects(
    () => mapped.requireAdmin(),
    error => error.kind === 'redirect' && error.path === '/admin/login',
  )
  database.exec('ROLLBACK TO mapped_admin_session; RELEASE mapped_admin_session')

  database.exec('UPDATE platform_role_assignment SET revoked_at = granted_at WHERE admin_id = 1')
  const revoked = await authModule('revoked')
  assert.equal(await revoked.getCurrentPlatformOwner(), null)
  await assert.rejects(
    () => revoked.requireAdmin(),
    error => error.kind === 'not-found',
  )

  database.exec(`
    UPDATE platform_role_assignment
    SET granted_at = 1, revoked_at = NULL, expires_at = 2
    WHERE admin_id = 1
  `)
  const expired = await authModule('expired')
  assert.equal(await expired.getCurrentPlatformOwner(), null)
  await assert.rejects(
    () => expired.requireAdmin(),
    error => error.kind === 'not-found',
  )

  database.exec('DELETE FROM platform_role_assignment WHERE admin_id = 1')
  const missing = await authModule('missing')
  assert.equal(await missing.getCurrentPlatformOwner(), null)
  await assert.rejects(
    () => missing.requireAdmin(),
    error => error.kind === 'not-found',
  )

  globalThis.__adminAuthToken = null
  const anonymous = await authModule('anonymous')
  await assert.rejects(
    () => anonymous.requireAdmin(),
    error => error.kind === 'redirect' && error.path === '/admin/login',
  )

  const { GET } = await import('../app/media/[...key]/route.ts')
  const request = new Request('http://localhost/media/private/example.png')
  const mediaParams = { params: Promise.resolve({ key: ['private', 'example.png'] }) }
  globalThis.__mediaPublished = false
  globalThis.__mediaPrivate = true
  globalThis.__mediaPlatformOwner = null
  globalThis.__mediaUnifiedPlatformOwner = null
  globalThis.__mediaReads = 0

  const denied = await GET(request, mediaParams)
  assert.equal(denied.status, 404)
  assert.equal(globalThis.__mediaReads, 0)

  globalThis.__mediaPlatformOwner = { adminId: 1, uid: 'owner' }
  const privatePhoto = await GET(request, mediaParams)
  assert.equal(privatePhoto.status, 200)
  assert.equal(globalThis.__mediaReads, 1)

  globalThis.__mediaPublished = true
  globalThis.__mediaPlatformOwner = null
  const publicPhoto = await GET(request, mediaParams)
  assert.equal(publicPhoto.status, 200)
  assert.equal(globalThis.__mediaReads, 2)

  for (const response of [denied, privatePhoto, publicPhoto]) {
    assert.match(response.headers.get('cache-control') ?? '', /no-store/)
  }
  console.log('admin authorization session and media wiring tests passed')
} finally {
  database.close()
}

import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const source = path => new URL(path, import.meta.url).href
const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
const nextServerModule = dataModule(`
  export const NextResponse = {
    json(value, init = {}) {
      return new Response(JSON.stringify(value), {
        ...init,
        headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
      })
    },
  }
`)
const csrfModule = dataModule(`
  export class CsrfError extends Error {}
  export function assertCsrfRequest() {}
`)
const cacheModule = dataModule(`
  export function withPrivateNoStore(response) {
    response.headers.set('cache-control', 'private, no-store')
    return response
  }
`)
const bindingsModule = dataModule(`
  export function cloudflareBindings() { return globalThis.__membershipRouteBindings }
`)
const kernelModule = dataModule(`
  export async function getAuthContext() { return globalThis.__membershipRouteContext }
`)

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: dataModule('export {}'), shortCircuit: true }
    if (specifier === 'next/server') return { url: nextServerModule, shortCircuit: true }
    if (specifier === 'next/headers') {
      return {
        url: dataModule(`export async function cookies() { throw new Error('unexpected') }`),
        shortCircuit: true,
      }
    }
    if (specifier === '../cloudflare-bindings.ts') {
      return {
        url: dataModule(`export function cloudflareBindings() { throw new Error('unexpected') }`),
        shortCircuit: true,
      }
    }
    if (specifier === '@/lib/cloudflare-bindings') {
      return { url: bindingsModule, shortCircuit: true }
    }
    if (specifier === '@/lib/csrf') return { url: csrfModule, shortCircuit: true }
    if (specifier === '@/lib/http-cache') return { url: cacheModule, shortCircuit: true }
    if (specifier === '@/lib/identity/internal/http') {
      return { url: source('../lib/identity/internal/http.ts'), shortCircuit: true }
    }
    if (specifier === '@/lib/identity/kernel') return { url: kernelModule, shortCircuit: true }
    if (specifier === '@/lib/identity/membership-service') {
      return { url: source('../lib/identity/membership-service.ts'), shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const { createMembershipDraft } = await import('../lib/identity/membership.ts')
const { submitMembershipApplication } = await import('../lib/identity/membership-application.ts')
const { claimMembershipApplication } = await import('../lib/identity/membership-review.ts')
const { accountIds, createIdentityKernelFixture, credentialIds, passwordCredentialIds } =
  await import('./identity-kernel-test-fixture.mjs')

const fixture = await createIdentityKernelFixture()
const { database, db, now } = fixture

function requestFor(application, decision, reasonCategory) {
  const request = new Request('https://example.test/api/admin/identity/membership', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      operation: 'review',
      applicationId: application.id,
      revision: String(application.revision),
      submissionVersion: String(application.submissionVersion),
      submissionDigest: application.submissionDigest,
      decision,
      reasonCategory,
      reason: 'HTTP decision compatibility test',
      targetReviewerAccountId: '',
      transferId: '',
      membershipId: '',
    }),
  })
  Object.defineProperty(request, 'cookies', { value: { get: () => undefined } })
  return request
}

try {
  const applicant = await fixture.session(
    accountIds.owner,
    { method: 'passkey', authenticatorCredentialId: credentialIds.owner },
    now - 10_000,
  )
  const reviewer = await fixture.session(
    accountIds.reviewer,
    { method: 'password', passwordCredentialId: passwordCredentialIds.reviewer },
    now - 10_000,
  )
  const draft = await createMembershipDraft(
    db,
    applicant.context,
    { identityClaim: 'HTTP review applicant', contact: 'http-review@example.test' },
    { now: now - 9_000 },
  )
  if (!draft.ok) throw new Error('Expected membership draft')
  const submitted = await submitMembershipApplication(
    db,
    applicant.context,
    { applicationId: draft.application.id, revision: draft.application.revision },
    { now: now - 8_000 },
  )
  if (!submitted.ok) throw new Error('Expected membership submission')
  const claimed = await claimMembershipApplication(
    db,
    reviewer.context,
    { applicationId: submitted.application.id, revision: submitted.application.revision },
    { now },
  )
  if (!claimed.ok) throw new Error('Expected membership claim')

  globalThis.__membershipRouteBindings = { db }
  globalThis.__membershipRouteContext = reviewer.context
  const { POST } = await import('../app/api/admin/identity/membership/route.ts')

  const incompatible = await POST(requestFor(claimed.application, 'approved', 'not_eligible'))
  assert.equal(incompatible.status, 400)
  assert.deepEqual(await incompatible.json(), {
    ok: false,
    error: '请检查审核决定和说明。',
    reauthenticate: false,
  })
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM identity_membership_review').get().count,
    0,
  )

  const compatible = await POST(requestFor(claimed.application, 'approved', 'eligible'))
  assert.equal(compatible.status, 200)
  assert.equal((await compatible.json()).ok, true)
  assert.equal(
    database
      .prepare('SELECT status FROM identity_membership_application WHERE id = ?')
      .get(claimed.application.id).status,
    'approved',
  )

  console.log('identity membership review HTTP compatibility tests passed')
} finally {
  delete globalThis.__membershipRouteBindings
  delete globalThis.__membershipRouteContext
  database.close()
}

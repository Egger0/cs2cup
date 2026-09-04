import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: dataModule('export {}'), shortCircuit: true }
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
    return nextResolve(specifier, context)
  },
})

const { resolveUnifiedConsolePermissions } = await import('../lib/identity/console-access.ts')
const { STAFF_RECENT_AUTH_MAX_AGE_MS } = await import('../lib/identity/internal/policy.ts')
const { accountIds, createIdentityKernelFixture, credentialIds, opaque, passwordCredentialIds } =
  await import('./identity-kernel-test-fixture.mjs')

const fixture = await createIdentityKernelFixture()
const { database, db, now } = fixture

try {
  const recentReviewer = await fixture.session(
    accountIds.reviewer,
    { method: 'password', passwordCredentialId: passwordCredentialIds.reviewer },
    now - 30 * 60 * 1000,
  )
  fixture.execute(
    `INSERT INTO identity_role_assignment
      (id, account_id, role, scope_type, scope_tournament_id, grant_reason, granted_at)
     VALUES (?, ?, 'referee', 'tournament', 71, 'Console workspace test', ?)`,
    [opaque('Z'), accountIds.reviewer, now - 1_000],
  )
  assert.deepEqual(await resolveUnifiedConsolePermissions(db, recentReviewer.context, now), {
    ok: true,
    permissions: { capabilities: [], hasTournamentWork: true },
  })

  const staleStaff = await fixture.session(
    accountIds.weakStaff,
    { method: 'password', passwordCredentialId: passwordCredentialIds.weakStaff },
    now - STAFF_RECENT_AUTH_MAX_AGE_MS - 1,
  )
  assert.deepEqual(await resolveUnifiedConsolePermissions(db, staleStaff.context, now), {
    ok: false,
    reason: 'reauthentication_required',
  })

  const boundaryStaff = await fixture.session(
    accountIds.weakStaff,
    { method: 'password', passwordCredentialId: passwordCredentialIds.weakStaff },
    now - STAFF_RECENT_AUTH_MAX_AGE_MS,
  )
  assert.deepEqual(await resolveUnifiedConsolePermissions(db, boundaryStaff.context, now), {
    ok: true,
    permissions: { capabilities: [], hasTournamentWork: true },
  })

  const reviewer = await fixture.session(accountIds.reviewer, {
    method: 'password',
    passwordCredentialId: passwordCredentialIds.reviewer,
  })
  assert.deepEqual(await resolveUnifiedConsolePermissions(db, reviewer.context, now), {
    ok: true,
    permissions: { capabilities: ['platform.identity.review'], hasTournamentWork: true },
  })

  const platformOwner = await fixture.session(accountIds.platformOwner, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.platformOwner,
  })
  const ownerAccess = await resolveUnifiedConsolePermissions(db, platformOwner.context, now)
  assert.equal(ownerAccess.ok, true)
  assert.equal(
    ownerAccess.ok && ownerAccess.permissions.capabilities.includes('platform.configure'),
    true,
  )

  console.log('identity console capability routing tests passed')
} finally {
  database.close()
}

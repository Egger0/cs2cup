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

const { grantManagedRole, listManagedRoleAssignments, revokeManagedRole } =
  await import('../lib/identity/role-management.ts')
const { accountIds, createIdentityKernelFixture, credentialIds } =
  await import('./identity-kernel-test-fixture.mjs')

const fixture = await createIdentityKernelFixture()
const { database, db, now } = fixture

try {
  const platformOwner = await fixture.session(accountIds.platformOwner, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.platformOwner,
  })

  assert.deepEqual(
    await grantManagedRole(
      db,
      platformOwner.context,
      {
        username: 'staff.user',
        role: 'organizer',
        tournamentId: null,
        reason: 'Organiser without a tournament',
      },
      { now: now + 14 },
    ),
    { ok: false, reason: 'invalid_input' },
  )
  const ownerGrant = await grantManagedRole(
    db,
    platformOwner.context,
    {
      username: 'staff.user',
      role: 'platform_owner',
      tournamentId: null,
      reason: 'Second platform owner',
    },
    { now: now + 14 },
  )
  assert.equal(ownerGrant.ok, true)
  if (!ownerGrant.ok) throw new Error('Expected platform owner grant')
  const owners = await listManagedRoleAssignments(db, platformOwner.context, { now: now + 14 })
  const seated = owners.ok ? owners.assignments.filter(item => item.role === 'platform_owner') : []
  assert.equal(seated.length, 2)
  assert.deepEqual(
    await revokeManagedRole(
      db,
      platformOwner.context,
      { assignmentId: ownerGrant.assignmentId, revision: 0, reason: 'Stepping back down' },
      { now: now + 14 },
    ),
    { ok: true },
  )
  const remaining = seated.find(item => item.id !== ownerGrant.assignmentId)
  assert.ok(remaining, 'Expected a seated platform owner to remain')
  assert.deepEqual(
    await revokeManagedRole(
      db,
      platformOwner.context,
      { assignmentId: remaining.id, revision: remaining.revision, reason: 'Removing the last one' },
      { now: now + 14 },
    ),
    { ok: false, reason: 'last_owner' },
  )
  console.log('identity role management tests passed')
} finally {
  database.close()
}

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

const { createMembershipDraft } = await import('../lib/identity/membership.ts')
const { submitMembershipApplication } = await import('../lib/identity/membership-application.ts')
const { claimMembershipApplication, reviewMembershipApplication } =
  await import('../lib/identity/membership-review.ts')
const { listApprovedMemberships } = await import('../lib/identity/membership-roster.ts')
const { listManagedRoleAssignments } = await import('../lib/identity/role-management.ts')
const { parsePageNumber } = await import('../lib/pagination.ts')
const { accountIds, createIdentityKernelFixture, credentialIds, passwordCredentialIds } =
  await import('./identity-kernel-test-fixture.mjs')

const fixture = await createIdentityKernelFixture()
const { database, db, now } = fixture

async function approveMembership(context, reviewer, offset) {
  const draft = await createMembershipDraft(
    db,
    context,
    {
      identityClaim: `Pagination applicant ${offset}`,
      contact: `pagination-${offset}@example.test`,
      applicationReason: 'Pagination coverage',
    },
    { now: now + offset },
  )
  if (!draft.ok) throw new Error('Unable to create pagination application')
  const submitted = await submitMembershipApplication(
    db,
    context,
    { applicationId: draft.application.id, revision: draft.application.revision },
    { now: now + offset + 1 },
  )
  if (!submitted.ok) throw new Error('Unable to submit pagination application')
  const claimed = await claimMembershipApplication(
    db,
    reviewer,
    { applicationId: submitted.application.id, revision: submitted.application.revision },
    { now: now + offset + 2 },
  )
  if (!claimed.ok) throw new Error('Unable to claim pagination application')
  const reviewed = await reviewMembershipApplication(
    db,
    reviewer,
    {
      applicationId: claimed.application.id,
      revision: claimed.application.revision,
      submissionVersion: claimed.application.submissionVersion,
      submissionDigest: claimed.application.submissionDigest,
      decision: 'approved',
      reasonCategory: 'eligible',
      reason: 'Eligible pagination fixture',
    },
    { now: now + offset + 3 },
  )
  if (!reviewed.ok) throw new Error('Unable to approve pagination application')
}

try {
  assert.equal(parsePageNumber('502', 20), 502)
  assert.equal(parsePageNumber('100000', 12), 100000)
  assert.equal(parsePageNumber(['37', '2'], 20), 37)
  assert.equal(parsePageNumber('0', 20), 1)
  assert.equal(parsePageNumber('9007199254740992', 20), 1)

  const [owner, manager, reviewer, platformOwner] = await Promise.all([
    fixture.session(accountIds.owner, {
      method: 'passkey',
      authenticatorCredentialId: credentialIds.owner,
    }),
    fixture.session(accountIds.manager, {
      method: 'passkey',
      authenticatorCredentialId: credentialIds.manager,
    }),
    fixture.session(accountIds.reviewer, {
      method: 'password',
      passwordCredentialId: passwordCredentialIds.reviewer,
    }),
    fixture.session(accountIds.platformOwner, {
      method: 'passkey',
      authenticatorCredentialId: credentialIds.platformOwner,
    }),
  ])
  await approveMembership(owner.context, reviewer.context, 10)
  await approveMembership(manager.context, reviewer.context, 20)

  const members = await listApprovedMemberships(db, reviewer.context, {
    now: now + 30,
    limit: 1,
    offset: 1,
  })
  assert.equal(members.ok && members.total, 2)
  assert.equal(members.ok && members.memberships.length, 1)
  assert.deepEqual(members.ok && members.pagination, {
    offset: 1,
    limit: 1,
    hasPrevious: true,
    hasNext: false,
  })
  assert.deepEqual(await listApprovedMemberships(db, reviewer.context, { offset: -1 }), {
    ok: false,
    reason: 'invalid_input',
  })
  assert.equal(
    (await listApprovedMemberships(db, reviewer.context, { limit: 1, offset: 10_020 })).ok,
    true,
  )

  const roles = await listManagedRoleAssignments(db, platformOwner.context, {
    now: now + 30,
    limit: 2,
    offset: 2,
  })
  assert.equal(roles.ok && roles.total, 4)
  assert.equal(roles.ok && roles.assignments.length, 2)
  assert.deepEqual(roles.ok && roles.pagination, {
    offset: 2,
    limit: 2,
    hasPrevious: true,
    hasNext: false,
  })
  assert.equal(
    (
      await listManagedRoleAssignments(db, platformOwner.context, {
        limit: 1,
        offset: 10_020,
      })
    ).ok,
    true,
  )
  console.log('identity administrative list pagination tests passed')
} finally {
  database.close()
}

import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
const cookiesModule = dataModule(
  `export async function cookies() { throw new Error('Unexpected cookie transport') }`,
)
const bindingsModule = dataModule(
  `export function cloudflareBindings() { throw new Error('Unexpected production binding') }`,
)
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: dataModule('export {}'), shortCircuit: true }
    if (specifier === 'next/headers') return { url: cookiesModule, shortCircuit: true }
    if (specifier === '../cloudflare-bindings.ts')
      return { url: bindingsModule, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

const { createMembershipDraft, getMembershipState, saveMembershipDraft } =
  await import('../lib/identity/membership.ts')
const { submitMembershipApplication, withdrawMembershipApplication } =
  await import('../lib/identity/membership-application.ts')
const { accountIds, createIdentityKernelFixture, credentialIds } =
  await import('./identity-kernel-test-fixture.mjs')

const fixture = await createIdentityKernelFixture()
const { database, db, now } = fixture

try {
  const owner = await fixture.session(accountIds.owner, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.owner,
  })
  const manager = await fixture.session(accountIds.manager, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.manager,
  })

  const created = await createMembershipDraft(db, owner.context, {}, { now })
  assert.equal(created.ok, true)
  if (!created.ok) throw new Error('Expected membership draft')
  assert.equal(created.application.status, 'draft')
  assert.equal(created.application.identityClaim, null)
  assert.deepEqual(await createMembershipDraft(db, owner.context, {}, { now: now + 1 }), {
    ok: false,
    reason: 'conflict',
  })
  assert.deepEqual(
    await submitMembershipApplication(
      db,
      owner.context,
      { applicationId: created.application.id, revision: 0 },
      { now: now + 2 },
    ),
    { ok: false, reason: 'incomplete' },
  )

  const saved = await saveMembershipDraft(
    db,
    owner.context,
    {
      applicationId: created.application.id,
      revision: 0,
      identityClaim: '  NBT student 20260001 ',
      contact: ' owner@example.test ',
      applicationReason: ' Join tournament registrations ',
    },
    { now: now + 3 },
  )
  assert.equal(saved.ok, true)
  if (!saved.ok) throw new Error('Expected saved membership draft')
  assert.equal(saved.application.identityClaim, 'NBT student 20260001')
  assert.deepEqual(
    await saveMembershipDraft(
      db,
      manager.context,
      {
        applicationId: created.application.id,
        revision: saved.application.revision,
        identityClaim: 'Cross-account mutation',
      },
      { now: now + 4 },
    ),
    { ok: false, reason: 'not_found' },
  )
  assert.deepEqual(
    await saveMembershipDraft(
      db,
      owner.context,
      {
        applicationId: created.application.id,
        revision: 0,
        identityClaim: 'Stale mutation',
      },
      { now: now + 4 },
    ),
    { ok: false, reason: 'conflict' },
  )

  const submitted = await submitMembershipApplication(
    db,
    owner.context,
    { applicationId: saved.application.id, revision: saved.application.revision },
    { now: now + 5 },
  )
  assert.equal(submitted.ok, true)
  if (!submitted.ok) throw new Error('Expected submitted membership application')
  assert.equal(submitted.application.status, 'pending')
  assert.equal(submitted.application.submissionVersion, 1)
  assert.match(submitted.application.submissionDigest, /^[0-9a-f]{64}$/)
  const reopened = await saveMembershipDraft(
    db,
    owner.context,
    {
      applicationId: submitted.application.id,
      revision: submitted.application.revision,
      identityClaim: submitted.application.identityClaim,
      contact: 'changed@example.test',
      applicationReason: submitted.application.applicationReason,
    },
    { now: now + 6 },
  )
  assert.equal(reopened.ok && reopened.application.status, 'draft')
  if (!reopened.ok) throw new Error('Expected pending application to reopen as a draft')
  const resubmitted = await submitMembershipApplication(
    db,
    owner.context,
    { applicationId: reopened.application.id, revision: reopened.application.revision },
    { now: now + 7 },
  )
  assert.equal(resubmitted.ok && resubmitted.application.submissionVersion, 2)
  if (!resubmitted.ok) throw new Error('Expected edited application resubmission')

  const state = await getMembershipState(db, owner.context, { now: now + 8 })
  assert.equal(state.ok, true)
  assert.equal(state.ok && state.application?.status, 'pending')
  assert.equal(state.ok && state.membership, null)
  const withdrawn = await withdrawMembershipApplication(
    db,
    owner.context,
    { applicationId: resubmitted.application.id, revision: resubmitted.application.revision },
    { now: now + 9 },
  )
  assert.equal(withdrawn.ok, true)
  assert.equal(withdrawn.ok && withdrawn.application.status, 'withdrawn')
  const replacement = await createMembershipDraft(
    db,
    owner.context,
    { identityClaim: 'Replacement draft' },
    { now: now + 10 },
  )
  assert.equal(replacement.ok, true)
  if (!replacement.ok) throw new Error('Expected replacement draft')
  const competingSaves = await Promise.all([
    saveMembershipDraft(
      db,
      owner.context,
      {
        applicationId: replacement.application.id,
        revision: replacement.application.revision,
        identityClaim: 'First concurrent edit',
      },
      { now: now + 11 },
    ),
    saveMembershipDraft(
      db,
      owner.context,
      {
        applicationId: replacement.application.id,
        revision: replacement.application.revision,
        identityClaim: 'Second concurrent edit',
      },
      { now: now + 11 },
    ),
  ])
  assert.equal(competingSaves.filter(result => result.ok).length, 1)
  assert.equal(
    competingSaves.filter(result => !result.ok && result.reason === 'conflict').length,
    1,
  )

  const events = database
    .prepare(
      `SELECT event_type FROM identity_security_event
       WHERE resource_type = 'membership_application' ORDER BY created_at`,
    )
    .all()
    .map(row => row.event_type)
  assert.deepEqual(events, [
    'membership.application.created',
    'membership.application.draft_saved',
    'membership.application.submitted',
    'membership.application.draft_saved',
    'membership.application.submitted',
    'membership.application.withdrawn',
    'membership.application.created',
    'membership.application.draft_saved',
  ])

  console.log('identity membership applicant service tests passed')
} finally {
  database.close()
}

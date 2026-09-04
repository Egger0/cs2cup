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

const { createMembershipDraft, getMembershipState } = await import('../lib/identity/membership.ts')
const { submitMembershipApplication } = await import('../lib/identity/membership-application.ts')
const { claimMembershipApplication, reviewMembershipApplication } =
  await import('../lib/identity/membership-review.ts')
const { changeMembershipStatus, listApprovedMemberships } =
  await import('../lib/identity/membership-roster.ts')
const { grantManagedRole, listManagedRoleAssignments, revokeManagedRole } =
  await import('../lib/identity/role-management.ts')
const { listPlatformAuditEvents } = await import('../lib/identity/audit-log.ts')
const { accountIds, createIdentityKernelFixture, credentialIds, opaque, passwordCredentialIds } =
  await import('./identity-kernel-test-fixture.mjs')

const fixture = await createIdentityKernelFixture()
const { database, db, now } = fixture
const count = (sql, ...bindings) => database.prepare(sql).get(...bindings).count

function beforeNextBatch(operation) {
  const batch = db.batch.bind(db)
  db.batch = async statements => {
    db.batch = batch
    operation()
    return batch(statements)
  }
}

try {
  const applicant = await fixture.session(accountIds.owner, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.owner,
  })
  const reviewer = await fixture.session(accountIds.reviewer, {
    method: 'password',
    passwordCredentialId: passwordCredentialIds.reviewer,
  })
  const platformOwner = await fixture.session(accountIds.platformOwner, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.platformOwner,
  })
  const sessionRaceOwner = await fixture.session(accountIds.platformOwner, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.platformOwner,
  })
  const roleRaceOwner = await fixture.session(accountIds.platformOwner, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.platformOwner,
  })
  const draft = await createMembershipDraft(
    db,
    applicant.context,
    {
      identityClaim: 'Membership status workflow',
      contact: 'member@example.test',
      applicationReason: 'Operations test',
    },
    { now: now + 1 },
  )
  if (!draft.ok) throw new Error('Expected membership draft')
  const submitted = await submitMembershipApplication(
    db,
    applicant.context,
    { applicationId: draft.application.id, revision: draft.application.revision },
    { now: now + 2 },
  )
  if (!submitted.ok) throw new Error('Expected membership submission')
  const claimed = await claimMembershipApplication(
    db,
    reviewer.context,
    { applicationId: submitted.application.id, revision: submitted.application.revision },
    { now: now + 3 },
  )
  if (!claimed.ok) throw new Error('Expected membership claim')
  assert.deepEqual(
    await reviewMembershipApplication(
      db,
      reviewer.context,
      {
        applicationId: claimed.application.id,
        revision: claimed.application.revision,
        submissionVersion: claimed.application.submissionVersion,
        submissionDigest: claimed.application.submissionDigest,
        decision: 'approved',
        reasonCategory: 'not_eligible',
        reason: 'Forged incompatible reason category',
      },
      { now: now + 4 },
    ),
    { ok: false, reason: 'invalid_input' },
  )
  const approved = await reviewMembershipApplication(
    db,
    reviewer.context,
    {
      applicationId: claimed.application.id,
      revision: claimed.application.revision,
      submissionVersion: claimed.application.submissionVersion,
      submissionDigest: claimed.application.submissionDigest,
      decision: 'approved',
      reasonCategory: 'eligible',
      reason: 'Eligibility confirmed for status workflow',
    },
    { now: now + 4 },
  )
  if (!approved.ok || !approved.membershipId) throw new Error('Expected approved membership')

  const roster = await listApprovedMemberships(db, reviewer.context, { now: now + 5 })
  assert.equal(roster.ok && roster.total, 1)
  const change = (operation, revision, reason, at) =>
    changeMembershipStatus(
      db,
      reviewer.context,
      { membershipId: approved.membershipId, revision, operation, reason },
      { now: at },
    )
  assert.deepEqual(await change('suspend', 0, 'Temporary eligibility review', now + 6), {
    ok: true,
    status: 'suspended',
  })
  const suspendedRoster = await listApprovedMemberships(db, reviewer.context, { now: now + 7 })
  assert.equal(suspendedRoster.ok && suspendedRoster.suspended, 1)
  assert.deepEqual(await change('restore', 1, 'Eligibility review completed', now + 8), {
    ok: true,
    status: 'approved',
  })
  assert.deepEqual(await change('revoke', 2, 'Membership permanently withdrawn', now + 9), {
    ok: true,
    status: 'revoked',
  })
  assert.deepEqual(await change('restore', 3, 'Forbidden terminal restore', now + 10), {
    ok: false,
    reason: 'invalid_state',
  })
  const finalState = await getMembershipState(db, applicant.context, { now: now + 11 })
  assert.equal(finalState.ok && finalState.membership?.status, 'revoked')
  assert.equal(count('SELECT COUNT(*) AS count FROM identity_membership_status_event'), 3)

  assert.deepEqual(
    await grantManagedRole(
      db,
      platformOwner.context,
      {
        username: 'staff.user',
        role: 'referee',
        tournamentId: 71,
        reason: 'Unavailable role surface',
      },
      { now: now + 12 },
    ),
    { ok: false, reason: 'invalid_input' },
  )
  const granted = await grantManagedRole(
    db,
    platformOwner.context,
    {
      username: 'staff.user',
      role: 'check_in_operator',
      tournamentId: 71,
      reason: 'Assigned to check-in operations',
    },
    { now: now + 12 },
  )
  assert.equal(granted.ok, true)
  if (!granted.ok) throw new Error('Expected role grant')
  const assignments = await listManagedRoleAssignments(db, platformOwner.context, {
    now: now + 13,
  })
  const checkInOperator = assignments.ok
    ? assignments.assignments.find(item => item.id === granted.assignmentId)
    : null
  assert.equal(checkInOperator?.role, 'check_in_operator')
  assert.deepEqual(
    await revokeManagedRole(
      db,
      platformOwner.context,
      { assignmentId: granted.assignmentId, revision: 0, reason: 'Match duty completed' },
      { now: now + 14 },
    ),
    { ok: true },
  )
  const audit = await listPlatformAuditEvents(db, platformOwner.context, {
    now: now + 15,
    limit: 20,
  })
  assert.equal(audit.ok, true)
  assert.equal(
    audit.ok &&
      audit.events.some(
        event =>
          event.label === '授予权限 · 签到操作员' &&
          event.subject === 'Person 4' &&
          event.resource === '赛事 · Kernel One' &&
          event.reason === 'Assigned to check-in operations',
      ),
    true,
  )

  const sessionRaceCorrelation = 'role.race.session.0001'
  beforeNextBatch(() => {
    fixture.execute(
      `UPDATE identity_session SET revoked_at = ?, revoke_reason = 'race test',
             revision = revision + 1, write_nonce = ? WHERE id = ?`,
      [now + 16, opaque('v'), sessionRaceOwner.context.session.id],
    )
  })
  assert.deepEqual(
    await grantManagedRole(
      db,
      sessionRaceOwner.context,
      {
        username: 'staff.user',
        role: 'check_in_operator',
        tournamentId: 71,
        reason: 'Session race must fail closed',
      },
      { now: now + 16, correlationId: sessionRaceCorrelation },
    ),
    { ok: false, reason: 'conflict' },
  )
  assert.equal(
    count(
      `SELECT COUNT(*) AS count FROM identity_role_assignment
       WHERE account_id = ? AND role = 'check_in_operator' AND revoked_at IS NULL`,
      accountIds.weakStaff,
    ),
    0,
  )
  assert.equal(
    count(
      'SELECT COUNT(*) AS count FROM identity_security_event WHERE request_correlation_id = ?',
      sessionRaceCorrelation,
    ),
    0,
  )

  const roleRaceGrant = await grantManagedRole(
    db,
    roleRaceOwner.context,
    {
      username: 'staff.user',
      role: 'check_in_operator',
      tournamentId: 71,
      reason: 'Prepare role revocation race',
    },
    { now: now + 17, correlationId: 'role.race.prepare.0001' },
  )
  if (!roleRaceGrant.ok) throw new Error('Expected race fixture grant')
  const roleRaceCorrelation = 'role.race.owner.0001'
  beforeNextBatch(() => {
    fixture.execute(
      `UPDATE identity_role_assignment
       SET revoked_by_account_id = ?, revoke_reason = 'race test', revoked_at = ?,
           revision = revision + 1, write_nonce = ? WHERE id = ?`,
      [accountIds.platformOwner, now + 18, opaque('w'), opaque('T')],
    )
  })
  assert.deepEqual(
    await revokeManagedRole(
      db,
      roleRaceOwner.context,
      {
        assignmentId: roleRaceGrant.assignmentId,
        revision: 0,
        reason: 'Owner role race must fail closed',
      },
      { now: now + 18, correlationId: roleRaceCorrelation },
    ),
    { ok: false, reason: 'conflict' },
  )
  assert.equal(
    database
      .prepare('SELECT revoked_at FROM identity_role_assignment WHERE id = ?')
      .get(roleRaceGrant.assignmentId).revoked_at,
    null,
  )
  assert.equal(
    count(
      'SELECT COUNT(*) AS count FROM identity_security_event WHERE request_correlation_id = ?',
      roleRaceCorrelation,
    ),
    0,
  )

  console.log('identity membership and role operations tests passed')
} finally {
  database.close()
}

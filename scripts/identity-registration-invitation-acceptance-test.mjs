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

const { acceptRegistrationInvitation, createRegistrationInvitation, RegistrationWorkflowError } =
  await import('../lib/identity/registration-workflow.ts')
const { accountIds, createIdentityKernelFixture, credentialIds, opaque, passwordCredentialIds } =
  await import('./identity-kernel-test-fixture.mjs')

const fixture = await createIdentityKernelFixture()
const { database, db, execute, now } = fixture
const invitationState = id =>
  database
    .prepare(
      `SELECT accepted_at, revoked_at, revision, write_nonce
       FROM identity_registration_invitation WHERE id = ?`,
    )
    .get(id)
const accessState = () =>
  database
    .prepare(
      `SELECT id, account_id, relationship, revoked_at, revision, write_nonce
       FROM identity_registration_membership WHERE team_id = 722 ORDER BY id`,
    )
    .all()
const eventCount = () =>
  database
    .prepare(
      `SELECT COUNT(*) AS count FROM identity_security_event
       WHERE resource_type = 'registration' AND resource_id = '722'`,
    )
    .get().count

try {
  const previousOwner = await fixture.session(accountIds.manager, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.manager,
  })
  const racedRecipient = await fixture.session(accountIds.weakStaff, {
    method: 'password',
    passwordCredentialId: passwordCredentialIds.weakStaff,
  })
  const invitation = await createRegistrationInvitation(db, previousOwner.context, {
    teamId: 722,
    username: 'staff.user',
    relationship: 'owner',
    now: now + 1,
  })
  const beforeRace = {
    invitation: invitationState(invitation.id),
    access: accessState(),
    events: eventCount(),
  }
  const batch = db.batch.bind(db)
  db.batch = async statements => {
    db.batch = batch
    execute(
      `UPDATE identity_session
       SET revoked_at = ?, revoke_reason = 'Concurrent security change',
           revision = revision + 1, write_nonce = ?
       WHERE id = ? AND revoked_at IS NULL`,
      [now + 2, opaque('x'), racedRecipient.context.session.id],
    )
    return batch(statements)
  }
  await assert.rejects(
    () => acceptRegistrationInvitation(db, racedRecipient.context, invitation.id, now + 2),
    error => {
      assert.equal(error instanceof RegistrationWorkflowError, true)
      assert.equal(error.code, 'conflict')
      return true
    },
  )
  assert.deepEqual(
    {
      invitation: invitationState(invitation.id),
      access: accessState(),
      events: eventCount(),
    },
    beforeRace,
  )

  const recipient = await fixture.session(
    accountIds.weakStaff,
    { method: 'password', passwordCredentialId: passwordCredentialIds.weakStaff },
    now + 3,
  )
  assert.deepEqual(
    await acceptRegistrationInvitation(db, recipient.context, invitation.id, now + 4),
    {
      teamId: 722,
      relationship: 'owner',
    },
  )
  const acceptedInvitation = invitationState(invitation.id)
  const event = database
    .prepare(
      `SELECT id, event_type, severity, actor_type, actor_account_id, target_account_id,
              actor_session_id, resource_type, resource_id, request_correlation_id,
              details_json, retention_class, created_at
       FROM identity_security_event
       WHERE event_type = 'registration.access.ownership_transferred'
         AND resource_type = 'registration' AND resource_id = '722'`,
    )
    .get()
  assert.ok(event)
  assert.deepEqual(
    {
      eventType: event.event_type,
      severity: event.severity,
      actorType: event.actor_type,
      actorAccountId: event.actor_account_id,
      targetAccountId: event.target_account_id,
      actorSessionId: event.actor_session_id,
      resourceType: event.resource_type,
      resourceId: event.resource_id,
      retentionClass: event.retention_class,
      createdAt: event.created_at,
    },
    {
      eventType: 'registration.access.ownership_transferred',
      severity: 'info',
      actorType: 'account',
      actorAccountId: accountIds.weakStaff,
      targetAccountId: accountIds.manager,
      actorSessionId: recipient.context.session.id,
      resourceType: 'registration',
      resourceId: '722',
      retentionClass: 'access_control',
      createdAt: now + 4,
    },
  )
  assert.equal(event.request_correlation_id, acceptedInvitation.write_nonce)
  const details = JSON.parse(event.details_json)
  assert.deepEqual(details, {
    invitationId: invitation.id,
    membershipId: details.membershipId,
    previousOwnerAccountId: accountIds.manager,
    newOwnerAccountId: accountIds.weakStaff,
    relationship: 'owner',
  })
  assert.match(details.membershipId, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM identity_registration_membership
         WHERE id = ? AND team_id = 722 AND account_id = ?
           AND relationship = 'owner' AND revoked_at IS NULL`,
      )
      .get(details.membershipId, accountIds.weakStaff).count,
    1,
  )
  assert.throws(
    () =>
      execute(`UPDATE identity_security_event SET severity = 'warning' WHERE id = ?`, [event.id]),
    /append-only/,
  )

  const [owner, promotedRecipient] = await Promise.all([
    fixture.session(accountIds.owner, {
      method: 'passkey',
      authenticatorCredentialId: credentialIds.owner,
    }),
    fixture.session(accountIds.reviewer, {
      method: 'password',
      passwordCredentialId: passwordCredentialIds.reviewer,
    }),
  ])
  const promotionInvitation = await createRegistrationInvitation(db, owner.context, {
    teamId: 711,
    username: 'reviewer.user',
    relationship: 'owner',
    now: now + 5,
  })
  const managerMembershipId = opaque('y')
  execute(
    `INSERT INTO identity_registration_membership
      (id, team_id, account_id, relationship, granted_by_account_id, grant_reason, granted_at)
     VALUES (?, 711, ?, 'manager', ?, 'Concurrent manager grant', ?)`,
    [managerMembershipId, accountIds.reviewer, accountIds.owner, now + 5],
  )
  const eventsBeforePromotionRace = database
    .prepare(
      `SELECT COUNT(*) AS count FROM identity_security_event
       WHERE event_type = 'registration.access.ownership_transferred'
         AND resource_type = 'registration' AND resource_id = '711'`,
    )
    .get().count
  db.batch = async statements => {
    db.batch = batch
    execute(
      `UPDATE identity_registration_membership
       SET expires_at = ?, revision = revision + 1, write_nonce = ?
       WHERE id = ? AND revoked_at IS NULL`,
      [now + 60_000, opaque('z'), managerMembershipId],
    )
    return batch(statements)
  }
  await assert.rejects(
    () =>
      acceptRegistrationInvitation(db, promotedRecipient.context, promotionInvitation.id, now + 6),
    error => error instanceof RegistrationWorkflowError && error.code === 'conflict',
  )
  assert.equal(invitationState(promotionInvitation.id).accepted_at, null)
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM identity_registration_membership
         WHERE team_id = 711 AND account_id = ? AND relationship = 'owner'
           AND revoked_at IS NULL`,
      )
      .get(accountIds.reviewer).count,
    0,
  )
  assert.deepEqual(
    {
      ...database
        .prepare(
          `SELECT relationship, revision, revoked_at FROM identity_registration_membership
           WHERE id = ?`,
        )
        .get(managerMembershipId),
    },
    { relationship: 'manager', revision: 1, revoked_at: null },
  )
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM identity_security_event
         WHERE event_type = 'registration.access.ownership_transferred'
           AND resource_type = 'registration' AND resource_id = '711'`,
      )
      .get().count,
    eventsBeforePromotionRace,
  )

  console.log('identity registration invitation acceptance tests passed')
} finally {
  database.close()
}

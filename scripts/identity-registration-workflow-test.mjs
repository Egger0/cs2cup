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
    if (specifier === '../cloudflare-bindings.ts') {
      return { url: bindingsModule, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const {
  acceptRegistrationInvitation,
  attachLegacyRegistration,
  createRegistrationInvitation,
  deleteOwnedRegistration,
  getRegistrationDraft,
  listAccountTournamentRegistrations,
  listIncomingRegistrationInvitations,
  listRegistrationDrafts,
  registrationAccessOverview,
  RegistrationWorkflowError,
  removeRegistrationManager,
  revokeRegistrationInvitation,
  saveRegistrationDraft,
} = await import('../lib/identity/registration-workflow.ts')
const { hashRegistrationToken } = await import('../lib/registration-access.ts')
const { accountIds, createIdentityKernelFixture, credentialIds, opaque, passwordCredentialIds } =
  await import('./identity-kernel-test-fixture.mjs')

const fixture = await createIdentityKernelFixture()
const { database, db, execute, now } = fixture
const passkey = name => ({
  method: 'passkey',
  authenticatorCredentialId: credentialIds[name],
})
const expectWorkflowError = (operation, code) =>
  assert.rejects(operation, error => {
    assert.equal(error instanceof RegistrationWorkflowError, true)
    assert.equal(error.code, code)
    return true
  })

try {
  const owner = await fixture.session(accountIds.owner, passkey('owner'))
  const manager = await fixture.session(accountIds.manager, passkey('manager'))
  const reviewer = await fixture.session(accountIds.reviewer, {
    method: 'password',
    passwordCredentialId: passwordCredentialIds.reviewer,
  })
  const draftValues = {
    name: 'Draft Team',
    tag: 'DFT',
    captain: 'Captain',
    contact: 'captain@example.test',
    dept: '',
    note: 'Pending account draft',
    players: ['One', 'Two', 'Three', 'Four', 'Five', ''],
  }
  assert.deepEqual(
    await saveRegistrationDraft(db, manager.context, {
      tournamentId: 72,
      values: draftValues,
      now,
    }),
    { revision: 0, updatedAt: now },
  )

  assert.equal((await getRegistrationDraft(db, manager.context, 'kernel-two')).values.tag, 'DFT')
  assert.deepEqual(
    await saveRegistrationDraft(db, manager.context, {
      tournamentId: 72,
      values: { ...draftValues, note: 'Restored and updated' },
      now: now + 1,
    }),
    { revision: 1, updatedAt: now + 1 },
  )
  assert.equal((await listRegistrationDrafts(db, manager.context))[0].revision, 1)

  const ownerEntries = await listAccountTournamentRegistrations(db, owner.context, now)
  assert.deepEqual(
    ownerEntries.map(entry => [entry.team.id, entry.relationship]),
    [[711, 'owner']],
  )
  assert.deepEqual(
    (await listAccountTournamentRegistrations(db, manager.context, now)).map(entry => [
      entry.team.id,
      entry.relationship,
    ]),
    [
      [722, 'owner'],
      [711, 'manager'],
    ],
  )

  await expectWorkflowError(
    () =>
      createRegistrationInvitation(db, manager.context, {
        teamId: 711,
        username: 'reviewer.user',
        relationship: 'owner',
        now,
      }),
    'forbidden',
  )
  await expectWorkflowError(
    () => deleteOwnedRegistration(db, manager.context, 711, now),
    'forbidden',
  )
  const staleOwner = await fixture.session(accountIds.owner, passkey('owner'), now - 16 * 60 * 1000)
  await expectWorkflowError(
    () =>
      createRegistrationInvitation(db, staleOwner.context, {
        teamId: 711,
        username: 'reviewer.user',
        relationship: 'manager',
        now,
      }),
    'reauth_required',
  )

  const expiredId = opaque('I')
  execute(
    `INSERT INTO identity_registration_invitation
      (id, team_id, invited_account_id, relationship, inviter_account_id, created_at, expires_at)
     VALUES (?, 711, ?, 'manager', ?, ?, ?)`,
    [expiredId, accountIds.weakStaff, accountIds.owner, now - 2_000, now - 1_000],
  )
  const renewed = await createRegistrationInvitation(db, owner.context, {
    teamId: 711,
    username: 'staff.user',
    relationship: 'manager',
    now,
  })
  assert.equal(
    database
      .prepare('SELECT revoked_at FROM identity_registration_invitation WHERE id = ?')
      .get(expiredId).revoked_at,
    now,
  )
  await revokeRegistrationInvitation(db, owner.context, {
    teamId: 711,
    invitationId: renewed.id,
    now: now + 1,
  })

  const managerInvite = await createRegistrationInvitation(db, owner.context, {
    teamId: 711,
    username: 'reviewer.user',
    relationship: 'manager',
    now: now + 2,
  })
  await expectWorkflowError(
    () =>
      createRegistrationInvitation(db, owner.context, {
        teamId: 711,
        username: 'reviewer.user',
        relationship: 'manager',
        now: now + 3,
      }),
    'conflict',
  )
  assert.deepEqual(
    (await listIncomingRegistrationInvitations(db, reviewer.context, now + 3)).map(
      invitation => invitation.id,
    ),
    [managerInvite.id],
  )
  assert.deepEqual(
    await acceptRegistrationInvitation(db, reviewer.context, managerInvite.id, now + 4),
    { teamId: 711, relationship: 'manager' },
  )
  const overview = await registrationAccessOverview(db, owner.context, 711, now + 5)
  const reviewerAccess = overview.managers.find(item => item.accountId === accountIds.reviewer)
  assert.ok(reviewerAccess)
  await expectWorkflowError(
    () => registrationAccessOverview(db, manager.context, 711, now + 5),
    'forbidden',
  )
  await removeRegistrationManager(db, owner.context, {
    teamId: 711,
    membershipId: reviewerAccess.membershipId,
    now: now + 6,
  })
  await expectWorkflowError(
    () =>
      removeRegistrationManager(db, owner.context, {
        teamId: 711,
        membershipId: reviewerAccess.membershipId,
        now: now + 7,
      }),
    'not_found',
  )

  const oldOwnerInvite = await createRegistrationInvitation(db, owner.context, {
    teamId: 711,
    username: 'staff.user',
    relationship: 'manager',
    now: now + 8,
  })
  const transfer = await createRegistrationInvitation(db, owner.context, {
    teamId: 711,
    username: 'reviewer.user',
    relationship: 'owner',
    now: now + 8,
  })
  const raced = await Promise.allSettled([
    acceptRegistrationInvitation(db, reviewer.context, transfer.id, now + 9),
    acceptRegistrationInvitation(db, reviewer.context, transfer.id, now + 9),
  ])
  assert.equal(raced.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(raced.filter(result => result.status === 'rejected').length, 1)
  assert.deepEqual(
    database
      .prepare(
        `SELECT account_id, relationship FROM identity_registration_membership
         WHERE team_id = 711 AND revoked_at IS NULL ORDER BY relationship, account_id`,
      )
      .all()
      .map(row => [row.account_id, row.relationship]),
    [
      [accountIds.owner, 'manager'],
      [accountIds.manager, 'manager'],
      [accountIds.recovery, 'manager'],
      [accountIds.reviewer, 'owner'],
    ],
  )
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM identity_registration_membership
         WHERE team_id = 711 AND relationship = 'owner' AND revoked_at IS NULL`,
      )
      .get().count,
    1,
  )
  await expectWorkflowError(
    () => deleteOwnedRegistration(db, owner.context, 711, now + 10),
    'forbidden',
  )
  await revokeRegistrationInvitation(db, reviewer.context, {
    teamId: 711,
    invitationId: oldOwnerInvite.id,
    now: now + 10,
  })
  const reissuedByNewOwner = await createRegistrationInvitation(db, reviewer.context, {
    teamId: 711,
    username: 'staff.user',
    relationship: 'manager',
    now: now + 11,
  })
  assert.equal(
    database
      .prepare('SELECT inviter_account_id FROM identity_registration_invitation WHERE id = ?')
      .get(reissuedByNewOwner.id).inviter_account_id,
    accountIds.reviewer,
  )

  const token = opaque('z')
  const tokenHash = await hashRegistrationToken(token)
  execute(
    `INSERT INTO team
      (id, tournament_id, name, tag, captain, contact, status, management_token_hash)
     VALUES (723, 72, 'Legacy Team', 'LEG', 'Captain', 'private', 'pending', ?)`,
    [tokenHash],
  )
  assert.deepEqual(
    await attachLegacyRegistration(db, owner.context, { slug: 'kernel-two', token, now: now + 11 }),
    { teamId: 723 },
  )
  assert.deepEqual(
    await attachLegacyRegistration(db, owner.context, { slug: 'kernel-two', token, now: now + 12 }),
    { teamId: 723 },
  )
  assert.equal(
    database.prepare('SELECT management_token_hash FROM team WHERE id = 723').get()
      .management_token_hash,
    null,
  )
  const laterOwner = await fixture.session(
    accountIds.owner,
    passkey('owner'),
    now + 15 * 60 * 1000 + 20,
  )
  await expectWorkflowError(
    () =>
      attachLegacyRegistration(db, laterOwner.context, {
        slug: 'kernel-two',
        token,
        now: now + 15 * 60 * 1000 + 21,
      }),
    'not_found',
  )

  await deleteOwnedRegistration(db, manager.context, 722, now + 13)
  assert.equal(database.prepare('SELECT 1 FROM team WHERE id = 722').get(), undefined)

  console.log('identity registration workflow tests passed')
} finally {
  database.close()
}

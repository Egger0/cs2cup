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
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith('.') || /\.[a-z]+$/i.test(specifier)) throw error
      return nextResolve(`${specifier}.ts`, context)
    }
  },
})

const { accountSquads, createSquad, incomingSquadInvitations, inviteToSquad, parseSquadIdentity } =
  await import('../lib/squads.ts')
const { disbandSquad, removeSquadMember, respondToSquadInvitation, revokeSquadInvitation } =
  await import('../lib/squad-roster.ts')
const { registerSquad, squadTournaments } = await import('../lib/squad-registration.ts')
const { accountIds, createIdentityKernelFixture, credentialIds, hex, passwordCredentialIds } =
  await import('./identity-kernel-test-fixture.mjs')
const { approveMembership } = await import('./membership-approval-fixture.mjs')

const fixture = await createIdentityKernelFixture()
const { database, db, now } = fixture
const count = sql => database.prepare(sql).get().count

try {
  const owner = await fixture.session(accountIds.owner, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.owner,
  })
  const reviewer = await fixture.session(accountIds.reviewer, {
    method: 'password',
    passwordCredentialId: passwordCredentialIds.reviewer,
  })
  database.exec('UPDATE game SET roster_size = 3 WHERE id = 71')

  assert.equal(parseSquadIdentity('  ', 'KSQ'), null)
  assert.equal(parseSquadIdentity('Kernel', 'k'), null)
  assert.deepEqual(parseSquadIdentity(' Kernel Squad ', 'ksq'), {
    name: 'Kernel Squad',
    tag: 'KSQ',
  })

  const created = await createSquad(
    db,
    accountIds.owner,
    { gameId: 71, name: 'Kernel Squad', tag: 'KSQ' },
    now,
  )
  assert.equal(created.ok, true)
  const squadId = created.squadId
  assert.deepEqual(
    await createSquad(db, accountIds.owner, { gameId: 71, name: 'Other', tag: 'OTH' }, now),
    { ok: false, reason: 'already_in_squad' },
  )
  assert.deepEqual(
    await createSquad(
      db,
      accountIds.manager,
      { gameId: 71, name: 'Kernel Squad', tag: 'NEW' },
      now,
    ),
    { ok: false, reason: 'taken' },
  )
  assert.deepEqual(
    await createSquad(db, accountIds.manager, { gameId: 999, name: 'Ghost', tag: 'GST' }, now),
    { ok: false, reason: 'unavailable' },
  )

  const invite = (identifier, captainAccountId = accountIds.owner) =>
    inviteToSquad(db, { captainAccountId, squadId, identifier }, now + 1)
  assert.deepEqual(await invite('staff.user', accountIds.manager), {
    ok: false,
    reason: 'not_captain',
  })
  assert.deepEqual(await invite('nobody.here'), { ok: false, reason: 'not_found' })
  assert.deepEqual(await invite('@Staff.User'), { ok: true, displayName: 'Person 4' })
  assert.deepEqual(await invite('staff.user'), { ok: false, reason: 'pending' })
  assert.deepEqual(await invite('reviewer.user'), { ok: true, displayName: 'Person 6' })

  const [staffInvitation] = await incomingSquadInvitations(db, accountIds.weakStaff)
  const [reviewerInvitation] = await incomingSquadInvitations(db, accountIds.reviewer)
  assert.equal(staffInvitation.squadTag, 'KSQ')
  assert.equal(staffInvitation.openSeats, 2)
  const respond = (accountId, invitationId, accept) =>
    respondToSquadInvitation(db, { accountId, invitationId, accept }, now + 2)

  assert.deepEqual(await respond(accountIds.manager, staffInvitation.id, true), {
    ok: false,
    reason: 'not_found',
  })
  assert.deepEqual(await respond(accountIds.reviewer, reviewerInvitation.id, false), { ok: true })
  assert.deepEqual(await respond(accountIds.reviewer, reviewerInvitation.id, true), {
    ok: false,
    reason: 'not_found',
  })
  assert.deepEqual(await respond(accountIds.weakStaff, staffInvitation.id, true), { ok: true })

  const details = { contact: 'captain@example.test', dept: '', note: '' }
  const register = (context = owner.context, extra = {}) =>
    registerSquad(db, context, {
      squadId,
      tournamentId: 72,
      details,
      fingerprint: 'squad-fingerprint',
      managementTokenHash: hex('7'),
      now: now + 10,
      ...extra,
    })
  assert.deepEqual(await register(), { ok: false, reason: 'not_full' })

  await invite('reviewer.user')
  const [again] = await incomingSquadInvitations(db, accountIds.reviewer)
  await invite('reviewer.user')
  assert.deepEqual(await respond(accountIds.reviewer, again.id, true), { ok: true })
  assert.deepEqual(await invite('manager.none'), { ok: false, reason: 'not_found' })
  assert.throws(
    () =>
      database
        .prepare(
          'INSERT INTO squad_member (squad_id, game_id, account_id, joined_at) VALUES (?, 71, ?, 1)',
        )
        .run(squadId, accountIds.manager),
    /squad is full/,
  )
  const [squad] = await accountSquads(db, accountIds.weakStaff)
  assert.deepEqual(
    squad.members.map(member => [member.accountId, member.captain]),
    [
      [accountIds.owner, true],
      [accountIds.weakStaff, false],
      [accountIds.reviewer, false],
    ],
  )
  assert.deepEqual(squad.invitations, [], 'only the captain sees pending invitations')

  assert.deepEqual(await register(reviewer.context), { ok: false, reason: 'not_captain' })
  assert.deepEqual(await register(), { ok: false, reason: 'authorization_changed' })
  await approveMembership(db, owner.context, reviewer.context, now + 3)
  const registered = await register()
  assert.equal(registered.ok, true)
  assert.deepEqual(
    database
      .prepare(
        `SELECT player.nickname, player.sort_order, membership.account_id
         FROM player JOIN identity_registration_membership AS membership
           ON membership.player_id = player.id AND membership.relationship = 'player'
         WHERE player.team_id = ? ORDER BY player.sort_order`,
      )
      .all(registered.teamId)
      .map(row => ({ ...row })),
    [
      { nickname: 'Person 1', sort_order: 1, account_id: accountIds.owner },
      { nickname: 'Person 4', sort_order: 2, account_id: accountIds.weakStaff },
      { nickname: 'Person 6', sort_order: 3, account_id: accountIds.reviewer },
    ],
  )
  assert.equal(
    count(`SELECT COUNT(*) AS count FROM identity_registration_membership
           WHERE team_id = ${registered.teamId} AND relationship = 'owner'`),
    1,
  )
  assert.deepEqual(
    (await squadTournaments(db, { id: squadId, gameId: 71 })).map(entry => [
      entry.slug,
      entry.teamStatus,
    ]),
    [['kernel-two', 'pending']],
  )
  assert.deepEqual(await register(owner.context, { managementTokenHash: hex('8') }), {
    ok: false,
    reason: 'taken',
  })

  assert.deepEqual(
    await removeSquadMember(db, {
      actorAccountId: accountIds.owner,
      squadId,
      memberAccountId: accountIds.owner,
    }),
    { ok: false, reason: 'not_allowed' },
  )
  assert.deepEqual(
    await removeSquadMember(db, {
      actorAccountId: accountIds.reviewer,
      squadId,
      memberAccountId: accountIds.weakStaff,
    }),
    { ok: false, reason: 'not_allowed' },
  )
  assert.deepEqual(
    await removeSquadMember(db, {
      actorAccountId: accountIds.weakStaff,
      squadId,
      memberAccountId: accountIds.weakStaff,
    }),
    { ok: true },
  )
  await invite('staff.user')
  const [pending] = (await accountSquads(db, accountIds.owner))[0].invitations
  assert.deepEqual(
    await revokeSquadInvitation(
      db,
      { captainAccountId: accountIds.reviewer, invitationId: pending.id },
      now + 20,
    ),
    { ok: false, reason: 'not_found' },
  )
  assert.deepEqual(
    await revokeSquadInvitation(
      db,
      { captainAccountId: accountIds.owner, invitationId: pending.id },
      now + 20,
    ),
    { ok: true },
  )
  assert.deepEqual(await disbandSquad(db, { captainAccountId: accountIds.reviewer, squadId }), {
    ok: false,
    reason: 'not_captain',
  })
  assert.deepEqual(await disbandSquad(db, { captainAccountId: accountIds.owner, squadId }), {
    ok: true,
  })
  assert.equal(count('SELECT COUNT(*) AS count FROM squad_member'), 0)
  assert.equal(count('SELECT COUNT(*) AS count FROM squad_invitation'), 0)
  assert.equal(
    count(`SELECT COUNT(*) AS count FROM team WHERE id = ${registered.teamId}`),
    1,
    'disbanding keeps the tournament registration',
  )

  console.log('squad tests passed')
} finally {
  database.close()
}

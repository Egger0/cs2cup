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

const { accountSquads, createSquad, inviteToSquad } = await import('../lib/squads.ts')
const { addSquadGuest, removeSquadGuest } = await import('../lib/squad-roster.ts')
const { registerSquad } = await import('../lib/squad-registration.ts')
const { accountIds, createIdentityKernelFixture, credentialIds, hex } =
  await import('./identity-kernel-test-fixture.mjs')
const { submitMembership } = await import('./membership-approval-fixture.mjs')

const fixture = await createIdentityKernelFixture()
const { database, db, now } = fixture
const count = sql => database.prepare(sql).get().count

try {
  const owner = await fixture.session(accountIds.owner, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.owner,
  })
  database.exec('UPDATE game SET roster_size = 3 WHERE id = 71')
  await submitMembership(db, owner.context, now + 3)
  const details = { contact: 'captain@example.test', dept: '', note: '' }

  const withGuests = await createSquad(
    db,
    accountIds.owner,
    { gameId: 71, name: 'Guest Squad', tag: 'GST', guests: ['Ghost-1'] },
    now + 30,
  )
  assert.equal(withGuests.ok, true)
  const guestSquadId = withGuests.squadId
  const guest = input => addSquadGuest(db, { squadId: guestSquadId, ...input }, now + 31)
  assert.deepEqual(await guest({ captainAccountId: accountIds.reviewer, nickname: 'X' }), {
    ok: false,
    reason: 'not_captain',
  })
  assert.deepEqual(await guest({ captainAccountId: accountIds.owner, nickname: 'Ghost-1' }), {
    ok: false,
    reason: 'duplicate',
  })
  assert.deepEqual(await guest({ captainAccountId: accountIds.owner, nickname: 'Ghost-2' }), {
    ok: true,
  })
  assert.deepEqual(await guest({ captainAccountId: accountIds.owner, nickname: 'Ghost-3' }), {
    ok: false,
    reason: 'full',
  })
  assert.deepEqual(
    await inviteToSquad(
      db,
      { captainAccountId: accountIds.owner, squadId: guestSquadId, identifier: 'staff.user' },
      now + 32,
    ),
    { ok: false, reason: 'full' },
    'placeholders take seats',
  )
  const [guestSquad] = await accountSquads(db, accountIds.owner)
  assert.deepEqual(
    guestSquad.guests.map(entry => entry.nickname),
    ['Ghost-1', 'Ghost-2'],
  )
  const guestRegistration = await registerSquad(db, owner.context, {
    squadId: guestSquadId,
    tournamentId: 72,
    details,
    fingerprint: 'guest-fingerprint',
    managementTokenHash: hex('9'),
    now: now + 33,
  })
  assert.equal(guestRegistration.ok, true, 'a pending applicant can submit a registration')
  assert.deepEqual(
    database
      .prepare('SELECT nickname FROM player WHERE team_id = ? ORDER BY sort_order')
      .all(guestRegistration.teamId)
      .map(row => row.nickname),
    ['Person 1', 'Ghost-1', 'Ghost-2'],
  )
  assert.equal(
    count(`SELECT COUNT(*) AS count FROM identity_registration_membership
           WHERE team_id = ${guestRegistration.teamId} AND relationship = 'player'`),
    1,
    'only account members are linked to the registration',
  )
  assert.deepEqual(
    await removeSquadGuest(db, {
      captainAccountId: accountIds.owner,
      squadId: guestSquadId,
      guestId: guestSquad.guests[0].id,
    }),
    { ok: true },
  )

  console.log('squad guest tests passed')
} finally {
  database.close()
}

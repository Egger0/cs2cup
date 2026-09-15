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

const { checkInForStardust, stardustBalance, stardustWallet } = await import('../lib/stardust.ts')
const { matchPredictionBoard, placeMatchPrediction } = await import('../lib/match-prediction.ts')
const { accountIds, createIdentityKernelFixture, credentialIds, passwordCredentialIds } =
  await import('./identity-kernel-test-fixture.mjs')
const { approveMembership } = await import('./membership-approval-fixture.mjs')

const fixture = await createIdentityKernelFixture()
const { database, db, now } = fixture
const later = new Date(now + 3 * 60 * 60 * 1000).toISOString()
const balances = () =>
  Promise.all([
    stardustBalance(db, accountIds.owner),
    stardustBalance(db, accountIds.platformOwner),
  ])

try {
  const owner = await fixture.session(accountIds.owner, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.owner,
  })
  const second = await fixture.session(accountIds.platformOwner, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.platformOwner,
  })
  const reviewer = await fixture.session(accountIds.reviewer, {
    method: 'password',
    passwordCredentialId: passwordCredentialIds.reviewer,
  })

  assert.deepEqual(await checkInForStardust(db, accountIds.owner, now), {
    ok: false,
    reason: 'membership_required',
  })
  await approveMembership(db, owner.context, reviewer.context, now + 1)
  await approveMembership(db, second.context, reviewer.context, now + 10)

  assert.deepEqual(await checkInForStardust(db, accountIds.owner, now + 20), {
    ok: true,
    reward: 10,
  })
  assert.deepEqual(await checkInForStardust(db, accountIds.owner, now + 21), {
    ok: false,
    reason: 'already_checked_in',
  })
  const wallet = await stardustWallet(db, accountIds.owner, now + 22)
  assert.equal(wallet.eligible, true)
  assert.equal(wallet.checkedInToday, true)
  assert.equal(wallet.matchdayToday, true)
  assert.equal(wallet.balance, 30)
  assert.equal((await stardustWallet(db, accountIds.owner, now + 23)).balance, 30)
  await checkInForStardust(db, accountIds.platformOwner, now + 24)
  await stardustWallet(db, accountIds.platformOwner, now + 25)
  await stardustWallet(db, accountIds.manager, now + 25)
  assert.equal(await stardustBalance(db, accountIds.manager), 0)
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM stardust_grant').get().count,
    4,
    'grants are idempotent per member, kind and Shanghai day',
  )

  database.exec(`
    INSERT INTO team (id, tournament_id, name, tag, captain, contact, status)
    VALUES (7101, 71, 'Pool Alpha', 'PAL', 'A', 'x', 'approved'),
           (7102, 71, 'Pool Bravo', 'PBR', 'B', 'x', 'approved'),
           (7103, 71, 'Pool Charlie', 'PCH', 'C', 'x', 'approved');
    INSERT INTO match (id, tournament_id, round, slot, round_label, team_a_id, team_b_id, scheduled_at)
    VALUES (7001, 71, 0, 0, 'Semi', 7101, 7102, '${later}'),
           (7002, 71, 0, 1, 'Semi', 7101, 7103, '${new Date(now - 1000).toISOString()}');
  `)

  const place = (accountId, teamId, stake, at = now + 100, matchId = 7001) =>
    placeMatchPrediction(db, { accountId, matchId, teamId, stake }, at)

  assert.deepEqual(await place(accountIds.owner, 7101, 0), { ok: false, reason: 'invalid_stake' })
  assert.deepEqual(await place(accountIds.manager, 7101, 1), {
    ok: false,
    reason: 'membership_required',
  })
  assert.deepEqual(await place(accountIds.owner, 7103, 5), { ok: false, reason: 'closed' })
  assert.deepEqual(await place(accountIds.owner, 7101, 5, now + 100, 7002), {
    ok: false,
    reason: 'closed',
  })
  assert.deepEqual(await place(accountIds.owner, 7101, 31), {
    ok: false,
    reason: 'insufficient_balance',
  })
  assert.deepEqual(await place(accountIds.owner, 7101, 30), { ok: true })
  assert.deepEqual(await place(accountIds.owner, 7102, 1), { ok: false, reason: 'already_placed' })
  assert.deepEqual(await place(accountIds.platformOwner, 7102, 10), { ok: true })
  assert.deepEqual(await balances(), [0, 20])
  assert.throws(() => database.prepare('UPDATE match_prediction SET stake = 1').run())

  const open = await matchPredictionBoard(db, 7001, null, now + 200)
  assert.equal(open.phase, 'open')
  assert.equal(open.viewer, 'anonymous')
  assert.deepEqual(
    open.sides.map(side => [side.tag, side.stake, side.backers]),
    [
      ['PAL', 30, 1],
      ['PBR', 10, 1],
    ],
  )
  assert.equal((await matchPredictionBoard(db, 7001, accountIds.owner, later)).phase, 'closed')

  const settle = winner =>
    database.prepare('UPDATE match SET winner_team_id = ? WHERE id = 7001').run(winner)
  settle(7101)
  assert.deepEqual(await balances(), [40, 20])
  const settled = await matchPredictionBoard(db, 7001, accountIds.owner, now + 300)
  assert.equal(settled.phase, 'settled')
  assert.deepEqual(settled.mine, { teamId: 7101, stake: 30, status: 'won', delta: 10 })

  settle(7102)
  assert.deepEqual(await balances(), [0, 60], 'a corrected result re-settles the pool')

  settle(null)
  database
    .prepare('DELETE FROM match_prediction WHERE account_id = ?')
    .run(accountIds.platformOwner)
  settle(7102)
  assert.deepEqual(await balances(), [30, 30], 'nobody backed the winner, so every stake returns')

  settle(null)
  database.prepare('UPDATE match SET team_b_id = 7103 WHERE id = 7001').run()
  database.prepare('UPDATE match SET team_a_id = 7103, team_b_id = 7102 WHERE id = 7001').run()
  assert.equal(
    (await matchPredictionBoard(db, 7001, accountIds.owner, now + 400)).mine.status,
    'void',
  )
  assert.deepEqual(await balances(), [30, 30], 'a stake on a team no longer in the match returns')

  database.prepare('DELETE FROM match WHERE id = 7001').run()
  assert.deepEqual(await balances(), [30, 30])
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM match_prediction').get().count, 0)

  console.log('stardust prediction tests passed')
} finally {
  database.close()
}

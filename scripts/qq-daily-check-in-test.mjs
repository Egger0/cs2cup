import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
const cookiesModule = dataModule(`
  export async function cookies() { throw new Error('Unexpected cookie access') }
`)
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: dataModule('export {}'), shortCircuit: true }
    if (specifier === 'next/headers') return { url: cookiesModule, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

const {
  checkInFromQq,
  linkQqAccountByPrivateUsername,
  qqCheckInLeaderboard,
  unlinkQqAccountByUserOpenId,
} = await import('../lib/qq-daily-check-in.ts')
const { accountIds, createIdentityKernelFixture } =
  await import('./identity-kernel-test-fixture.mjs')

const groupOpenId = 'official-group-openid'
const ownerOpenId = 'owner-member-openid'
const ownerUserOpenId = 'owner-user-openid'
const managerOpenId = 'manager-member-openid'
const managerUserOpenId = 'manager-user-openid'
const at = (day, hour = 0, minute = 0) => Date.UTC(2026, 8, day, hour - 8, minute)

const fixture = await createIdentityKernelFixture()
try {
  const displayName = accountId =>
    fixture.database
      .prepare('SELECT display_name FROM identity_account WHERE id = ?')
      .get(accountId).display_name
  const reviewerName = displayName(accountIds.reviewer)
  const staffName = displayName(accountIds.weakStaff)

  assert.deepEqual(
    await linkQqAccountByPrivateUsername(
      fixture.db,
      { groupOpenId, userOpenId: ownerUserOpenId, username: 'Reviewer.User' },
      at(4, 20),
    ),
    { ok: true },
  )
  assert.deepEqual(
    await linkQqAccountByPrivateUsername(
      fixture.db,
      { groupOpenId, userOpenId: ownerUserOpenId, username: 'reviewer.user' },
      at(4, 20, 1),
    ),
    { ok: false, reason: 'already_bound' },
  )
  assert.deepEqual(
    await linkQqAccountByPrivateUsername(
      fixture.db,
      { groupOpenId, userOpenId: 'other-user-openid', username: 'reviewer.user' },
      at(4, 20, 2),
    ),
    { ok: false, reason: 'account_bound' },
  )
  assert.deepEqual(
    await linkQqAccountByPrivateUsername(
      fixture.db,
      { groupOpenId, userOpenId: 'invalid-user-openid', username: 'bad name' },
      at(4, 20, 3),
    ),
    { ok: false, reason: 'invalid_username' },
  )
  assert.deepEqual(
    await linkQqAccountByPrivateUsername(
      fixture.db,
      { groupOpenId, userOpenId: 'missing-user-openid', username: 'missing.user' },
      at(4, 20, 4),
    ),
    { ok: false, reason: 'username_not_found' },
  )
  assert.deepEqual(
    await unlinkQqAccountByUserOpenId(fixture.db, { groupOpenId, userOpenId: 'other-user-openid' }),
    { ok: false, reason: 'not_bound' },
  )
  assert.deepEqual(
    await unlinkQqAccountByUserOpenId(fixture.db, { groupOpenId, userOpenId: ownerUserOpenId }),
    {
      ok: true,
    },
  )
  assert.deepEqual(
    await checkInFromQq(
      fixture.db,
      { groupOpenId, memberOpenId: ownerOpenId, userOpenId: ownerUserOpenId },
      at(4, 21),
    ),
    { kind: 'unbound' },
  )
  assert.deepEqual(
    await linkQqAccountByPrivateUsername(
      fixture.db,
      { groupOpenId, userOpenId: ownerUserOpenId, username: 'reviewer.user' },
      at(4, 22),
    ),
    { ok: true },
  )
  fixture.execute(
    `INSERT INTO qq_account_link (account_id, group_openid, member_openid, linked_at)
     VALUES (?, ?, ?, ?)`,
    [accountIds.weakStaff, groupOpenId, managerOpenId, at(5, 8)],
  )
  assert.deepEqual(
    await linkQqAccountByPrivateUsername(
      fixture.db,
      { groupOpenId, userOpenId: managerUserOpenId, username: 'staff.user' },
      at(5, 8, 1),
    ),
    { ok: true },
  )

  assert.deepEqual(
    await checkInFromQq(
      fixture.db,
      { groupOpenId, memberOpenId: ownerOpenId, userOpenId: ownerUserOpenId },
      at(4, 23, 59),
    ),
    { kind: 'checked_in', streak: 1, rank: 1, reward: 0 },
  )
  assert.deepEqual(
    await checkInFromQq(
      fixture.db,
      { groupOpenId, memberOpenId: ownerOpenId, userOpenId: ownerUserOpenId },
      at(4, 23, 59) + 1,
    ),
    { kind: 'already_checked_in', streak: 1 },
  )
  assert.deepEqual(
    await checkInFromQq(
      fixture.db,
      { groupOpenId, memberOpenId: ownerOpenId, userOpenId: ownerUserOpenId },
      at(5, 0, 0),
    ),
    { kind: 'checked_in', streak: 2, rank: 1, reward: 0 },
  )
  assert.deepEqual(
    await checkInFromQq(
      fixture.db,
      { groupOpenId, memberOpenId: managerOpenId, userOpenId: managerUserOpenId },
      at(5, 8, 4),
    ),
    { kind: 'checked_in', streak: 1, rank: 2, reward: 0 },
  )
  assert.deepEqual(await qqCheckInLeaderboard(fixture.db, groupOpenId, at(5, 9)), [
    { displayName: reviewerName, streak: 2, lastCheckInDate: '2026-09-05' },
    { displayName: staffName, streak: 1, lastCheckInDate: '2026-09-05' },
  ])
  assert.deepEqual(
    await checkInFromQq(
      fixture.db,
      { groupOpenId, memberOpenId: ownerOpenId, userOpenId: ownerUserOpenId },
      at(7, 8),
    ),
    { kind: 'checked_in', streak: 1, rank: 1, reward: 0 },
  )
  assert.deepEqual(await qqCheckInLeaderboard(fixture.db, groupOpenId, at(7, 9)), [
    { displayName: reviewerName, streak: 1, lastCheckInDate: '2026-09-07' },
  ])
  assert.deepEqual(await qqCheckInLeaderboard(fixture.db, 'empty-group', at(7, 9)), [])
} finally {
  fixture.database.close()
}

console.log('QQ daily check-in tests passed')

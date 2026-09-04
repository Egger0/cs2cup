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

const { checkInFromQq, generateQqBindingCode, linkQqAccount, qqCheckInLeaderboard } =
  await import('../lib/qq-daily-check-in.ts')
const { accountIds, createIdentityKernelFixture, credentialIds } =
  await import('./identity-kernel-test-fixture.mjs')

const groupOpenId = 'official-group-openid'
const ownerOpenId = 'owner-member-openid'
const managerOpenId = 'manager-member-openid'
const at = (day, hour = 0, minute = 0) => Date.UTC(2026, 8, day, hour - 8, minute)

const fixture = await createIdentityKernelFixture()
try {
  const owner = await fixture.session(accountIds.owner, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.owner,
  })
  const manager = await fixture.session(accountIds.manager, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.manager,
  })

  const firstCode = await generateQqBindingCode(fixture.db, owner.context, at(4, 20))
  assert.equal(firstCode.ok, true)
  if (!firstCode.ok) throw new Error('owner code missing')
  assert.match(firstCode.code, /^[A-HJ-NP-Z2-9]{8}$/)
  assert.notEqual(
    fixture.database.prepare('SELECT code_hash FROM qq_binding_code').get().code_hash,
    firstCode.code,
  )
  assert.deepEqual(
    await linkQqAccount(
      fixture.db,
      { groupOpenId, memberOpenId: ownerOpenId, code: firstCode.code },
      at(4, 20, 1),
    ),
    { ok: true },
  )
  assert.deepEqual(
    await linkQqAccount(
      fixture.db,
      { groupOpenId, memberOpenId: ownerOpenId, code: firstCode.code },
      at(4, 20, 2),
    ),
    { ok: false, reason: 'already_bound' },
  )

  const ownerFirst = await checkInFromQq(
    fixture.db,
    { groupOpenId, memberOpenId: ownerOpenId },
    at(4, 23, 59),
  )
  assert.deepEqual(ownerFirst, { kind: 'checked_in', streak: 1, rank: 1 })
  assert.deepEqual(
    await checkInFromQq(fixture.db, { groupOpenId, memberOpenId: ownerOpenId }, at(4, 23, 59) + 1),
    { kind: 'already_checked_in', streak: 1 },
  )
  assert.deepEqual(
    await checkInFromQq(fixture.db, { groupOpenId, memberOpenId: ownerOpenId }, at(5, 0, 0)),
    { kind: 'checked_in', streak: 2, rank: 1 },
  )

  const expiredManagerCode = await generateQqBindingCode(fixture.db, manager.context, at(5, 7))
  assert.equal(expiredManagerCode.ok, true)
  if (!expiredManagerCode.ok) throw new Error('expired manager code missing')
  assert.deepEqual(
    await linkQqAccount(
      fixture.db,
      { groupOpenId, memberOpenId: managerOpenId, code: expiredManagerCode.code },
      at(5, 7, 11),
    ),
    { ok: false, reason: 'invalid_code' },
  )

  const managerCode = await generateQqBindingCode(fixture.db, manager.context, at(5, 8))
  assert.equal(managerCode.ok, true)
  if (!managerCode.ok) throw new Error('manager code missing')
  assert.deepEqual(
    await linkQqAccount(
      fixture.db,
      { groupOpenId, memberOpenId: managerOpenId, code: managerCode.code },
      at(5, 8, 1),
    ),
    { ok: true },
  )
  const duplicateAccountCode = await generateQqBindingCode(fixture.db, manager.context, at(5, 8, 2))
  assert.equal(duplicateAccountCode.ok, true)
  if (!duplicateAccountCode.ok) throw new Error('duplicate account code missing')
  assert.deepEqual(
    await linkQqAccount(
      fixture.db,
      { groupOpenId, memberOpenId: 'other-member-openid', code: duplicateAccountCode.code },
      at(5, 8, 3),
    ),
    { ok: false, reason: 'account_bound' },
  )
  assert.deepEqual(
    await checkInFromQq(fixture.db, { groupOpenId, memberOpenId: managerOpenId }, at(5, 8, 4)),
    { kind: 'checked_in', streak: 1, rank: 2 },
  )
  assert.deepEqual(await qqCheckInLeaderboard(fixture.db, groupOpenId, at(5, 9)), [
    { displayName: 'Person 1', streak: 2, lastCheckInDate: '2026-09-05' },
    { displayName: 'Person 2', streak: 1, lastCheckInDate: '2026-09-05' },
  ])
  assert.deepEqual(
    await checkInFromQq(fixture.db, { groupOpenId, memberOpenId: 'unbound-member' }, at(5, 9)),
    { kind: 'unbound' },
  )
  assert.deepEqual(
    await checkInFromQq(fixture.db, { groupOpenId, memberOpenId: ownerOpenId }, at(7, 8)),
    { kind: 'checked_in', streak: 1, rank: 1 },
  )
  assert.deepEqual(await qqCheckInLeaderboard(fixture.db, groupOpenId, at(7, 9)), [
    { displayName: 'Person 1', streak: 1, lastCheckInDate: '2026-09-07' },
  ])
  assert.deepEqual(await qqCheckInLeaderboard(fixture.db, 'empty-group', at(7, 9)), [])
} finally {
  fixture.database.close()
}

console.log('QQ daily check-in tests passed')

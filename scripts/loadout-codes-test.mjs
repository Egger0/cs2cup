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

const {
  listLoadoutCodes,
  listOwnLoadoutCodes,
  listPendingLoadoutCodes,
  parseLoadoutInput,
  reviewLoadoutCode,
  submitLoadoutCode,
} = await import('../lib/loadout-codes.ts')
const { accountIds, createIdentityKernelFixture } =
  await import('./identity-kernel-test-fixture.mjs')

const { database, db, now } = await createIdentityKernelFixture()
const valid = { weapon: 'M4A1', title: '低后坐', code: '6F7K-2Q9P-TT41', note: '' }
const submit = (accountId, value, at = now) =>
  submitLoadoutCode(db, { accountId, gameId: 71, value }, at)
const review = (id, decision, at) =>
  reviewLoadoutCode(db, { id, reviewerAccountId: accountIds.platformOwner, decision }, at)

try {
  assert.deepEqual(parseLoadoutInput({ ...valid, weapon: '  ' }), { ok: false, field: 'weapon' })
  assert.deepEqual(parseLoadoutInput({ ...valid, code: 'abc' }), { ok: false, field: 'code' })
  assert.deepEqual(parseLoadoutInput({ ...valid, note: 'x'.repeat(201) }), {
    ok: false,
    field: 'note',
  })
  assert.deepEqual(parseLoadoutInput({ ...valid, title: `a${String.fromCharCode(7)}` }), {
    ok: false,
    field: 'title',
  })
  assert.deepEqual(parseLoadoutInput({ ...valid, weapon: ' M4A1 ' }), { ok: true, value: valid })

  assert.deepEqual(await submit(accountIds.owner, valid), { ok: false, reason: 'closed' })
  database.prepare('UPDATE game SET loadout_codes = 1 WHERE id = 71').run()
  assert.deepEqual(await submit(accountIds.owner, valid), { ok: true })
  assert.deepEqual(await submit(accountIds.manager, valid), { ok: false, reason: 'duplicate' })
  for (let index = 1; index < 5; index += 1) {
    assert.deepEqual(await submit(accountIds.owner, { ...valid, code: `CODE-${index}` }), {
      ok: true,
    })
  }
  assert.deepEqual(await submit(accountIds.owner, { ...valid, code: 'CODE-9' }), {
    ok: false,
    reason: 'limit',
  })
  assert.throws(() =>
    database
      .prepare(
        `INSERT INTO loadout_code
          (game_id, account_id, weapon, title, code, status, created_at, reviewed_at)
         VALUES (71, ?, 'AK', 'direct', 'DIRECT-1', 'approved', 1, 1)`,
      )
      .run(accountIds.manager),
  )

  assert.equal((await listPendingLoadoutCodes(db)).length, 5)
  assert.deepEqual(await listLoadoutCodes(db, 71), [])
  const [first, second] = await listPendingLoadoutCodes(db)
  assert.deepEqual(await review(first.id, 'approved', now + 1), {
    ok: true,
    gameSlug: 'identity-kernel',
  })
  assert.deepEqual(
    await review(first.id, 'rejected', now + 2),
    { ok: false },
    'decisions are final',
  )
  await review(second.id, 'rejected', now + 3)
  assert.deepEqual(
    (await listLoadoutCodes(db, 71)).map(code => [code.code, code.status]),
    [['6F7K-2Q9P-TT41', 'approved']],
  )
  assert.deepEqual(
    (await listOwnLoadoutCodes(db, 71, accountIds.owner)).map(code => code.status).sort(),
    ['approved', 'pending', 'pending', 'pending', 'rejected'],
  )
  assert.deepEqual(await submit(accountIds.owner, { ...valid, code: 'CODE-9' }), { ok: true })

  console.log('loadout code tests passed')
} finally {
  database.close()
}

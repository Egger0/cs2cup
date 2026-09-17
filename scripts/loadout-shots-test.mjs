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

const { listLoadoutCodesForReview, reviewLoadoutCode, submitLoadoutCode } =
  await import('../lib/loadout-codes.ts')
const { loadoutShotAccess, replaceLoadoutShot, reviewLoadoutShot } =
  await import('../lib/loadout-shots.ts')
const { accountIds, createIdentityKernelFixture } =
  await import('./identity-kernel-test-fixture.mjs')

const { database, db, now } = await createIdentityKernelFixture()
const build = code => ({
  code,
  mode: 'operations',
  weapon: 'M4A1突击步枪',
  title: '截图测试',
  note: null,
  tags: [],
  price: null,
  stats: null,
})

try {
  database.prepare('UPDATE game SET loadout_codes = 1 WHERE id = 71').run()
  const submit = (code, shotKey) =>
    submitLoadoutCode(
      db,
      { accountId: accountIds.owner, gameId: 71, value: build(code), shotKey },
      now,
    )
  const first = await submit('6I57UD4080ELE0AQVMCG8', 'loadouts/a.webp')
  const queuedCode = await submit('6I57UD4080ELE0AQVMC01', null)
  await reviewLoadoutCode(
    db,
    { id: first.id, reviewerAccountId: accountIds.platformOwner, decision: 'approved' },
    now + 1,
  )

  const shots = id =>
    database
      .prepare('SELECT shot_key AS shot, pending_shot_key AS queued FROM loadout_code WHERE id = ?')
      .get(id)
  const replace = (id, accountId, key) => replaceLoadoutShot(db, { id, accountId, key })
  assert.deepEqual(await replace(queuedCode.id, accountIds.manager, 'loadouts/x.webp'), {
    ok: false,
  })
  assert.deepEqual(await replace(queuedCode.id, accountIds.owner, 'loadouts/p1.webp'), {
    ok: true,
    review: false,
    gameSlug: 'identity-kernel',
    stale: null,
  })
  assert.deepEqual({ ...shots(queuedCode.id) }, { shot: 'loadouts/p1.webp', queued: null })
  assert.deepEqual(await replace(first.id, accountIds.owner, 'loadouts/n1.webp'), {
    ok: true,
    review: true,
    gameSlug: 'identity-kernel',
    stale: null,
  })
  assert.equal(
    (await replace(first.id, accountIds.owner, 'loadouts/n2.webp')).stale,
    'loadouts/n1.webp',
  )
  assert.deepEqual({ ...shots(first.id) }, { shot: 'loadouts/a.webp', queued: 'loadouts/n2.webp' })
  assert.deepEqual(await loadoutShotAccess(db, 'loadouts/a.webp'), {
    published: true,
    accountId: accountIds.owner,
  })
  assert.deepEqual(await loadoutShotAccess(db, 'loadouts/n2.webp'), {
    published: false,
    accountId: accountIds.owner,
  })
  assert.deepEqual(
    (await listLoadoutCodesForReview(db)).shots.map(code => [code.id, code.pendingShotKey]),
    [[first.id, 'loadouts/n2.webp']],
  )
  assert.deepEqual(await reviewLoadoutShot(db, { id: first.id, approve: true }), {
    ok: true,
    gameSlug: 'identity-kernel',
    stale: 'loadouts/a.webp',
  })
  assert.deepEqual({ ...shots(first.id) }, { shot: 'loadouts/n2.webp', queued: null })
  assert.deepEqual(await reviewLoadoutShot(db, { id: first.id, approve: true }), { ok: false })
  await replace(first.id, accountIds.owner, 'loadouts/n3.webp')
  assert.deepEqual(await reviewLoadoutShot(db, { id: first.id, approve: false }), {
    ok: true,
    gameSlug: 'identity-kernel',
    stale: 'loadouts/n3.webp',
  })
  assert.deepEqual({ ...shots(first.id) }, { shot: 'loadouts/n2.webp', queued: null })

  console.log('loadout shot tests passed')
} finally {
  database.close()
}

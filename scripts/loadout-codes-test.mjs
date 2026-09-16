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

const {
  loadoutDigest,
  getLoadoutCode,
  listAuthorLoadoutCodes,
  listLoadoutCodes,
  listLoadoutCodesForReview,
  listOwnLoadoutCodes,
  recordLoadoutCopy,
  reviewLoadoutCode,
  submitLoadoutCode,
} = await import('../lib/loadout-codes.ts')
const {
  listLoadoutComments,
  listViewerLoadoutMarks,
  parseLoadoutComment,
  postLoadoutComment,
  removeLoadoutComment,
  reportLoadoutCode,
  setLoadoutLike,
} = await import('../lib/loadout-community.ts')
const { parseLoadoutInput } = await import('../lib/loadout-input.ts')
const { codeSharedAt, parsePastedLoadout, shareString } = await import('../lib/delta-loadouts.ts')
const { accountIds, createIdentityKernelFixture } =
  await import('./identity-kernel-test-fixture.mjs')

const CODE = '6I57UD4080ELE0AQVMCG8'
const form = fields => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    for (const item of [value].flat()) data.append(key, item)
  }
  return data
}
const validFields = {
  code: `M4A1突击步枪-烽火地带-${CODE}`,
  mode: 'operations',
  weapon: 'M4A1突击步枪',
  title: '低后坐',
  note: '',
  tags: ['后坐力稳', '高性价比'],
  price: '32.5',
  recoil: '71',
  handling: '48',
  stability: '66',
  hipfire: '40',
  distance: '52',
}
const parse = fields => parseLoadoutInput(form({ ...validFields, ...fields }))
const valueWith = code => ({ ...parse({}).value, code })
const codeAt = index => `6I57UD4080ELE0AQVMC${String(index).padStart(2, '0')}`

const { database, db, now } = await createIdentityKernelFixture()
const submit = (accountId, value, at = now, shotKey = null) =>
  submitLoadoutCode(db, { accountId, gameId: 71, value, shotKey }, at)
const review = (id, decision, at) =>
  reviewLoadoutCode(db, { id, reviewerAccountId: accountIds.platformOwner, decision }, at)

try {
  assert.deepEqual(
    parsePastedLoadout('  AS Val突击步枪－全面战场－6eiakvc02u9hu6ac38cqj（别带括号）'),
    {
      code: '6EIAKVC02U9HU6AC38CQJ',
      mode: 'warfare',
      weapon: parsePastedLoadout(`AS Val突击步枪-全面战场-${CODE}`).weapon,
      label: null,
    },
  )
  const custom = parsePastedLoadout('推荐：AKM性价比黑科技-烽火地带-6G7FDPS04NFDQKJMA4APK')
  assert.equal(custom.weapon.name, 'AKM突击步枪')
  assert.equal(custom.label, 'AKM性价比黑科技')
  assert.deepEqual(parsePastedLoadout(CODE), { code: CODE, mode: null, weapon: null, label: null })
  assert.equal(parsePastedLoadout('6I57UD4080ELE0AQVMCG8X'), null, 'bodies are exactly 21 chars')
  assert.equal(parsePastedLoadout('6I57UD4080ELE0AQVMCGW'), null, 'W is outside base32hex')
  assert.equal(new Date(codeSharedAt(CODE)).toISOString(), '2025-11-12T21:38:49.000Z')
  assert.equal(codeSharedAt('000000000000000000000'), null)
  assert.equal(shareString('G18', 'warfare', CODE), `G18-全面战场-${CODE}`)

  assert.deepEqual(parse({}), {
    ok: true,
    value: {
      code: CODE,
      mode: 'operations',
      weapon: 'M4A1突击步枪',
      title: '低后坐',
      note: null,
      tags: ['后坐力稳', '高性价比'],
      price: 325000,
      stats: { recoil: 71, handling: 48, stability: 66, hipfire: 40, distance: 52 },
    },
  })
  assert.deepEqual(parse({ code: 'abc' }), { ok: false, field: 'code' })
  assert.deepEqual(parse({ mode: 'ranked' }), { ok: false, field: 'mode' })
  assert.deepEqual(parse({ weapon: 'AK' }), { ok: false, field: 'weapon' })
  assert.deepEqual(parse({ title: `a${String.fromCharCode(7)}` }), { ok: false, field: 'title' })
  assert.deepEqual(parse({ note: 'x'.repeat(201) }), { ok: false, field: 'note' })
  assert.deepEqual(parse({ tags: ['后坐力稳', '赌狗'] }), { ok: false, field: 'tags' })
  assert.deepEqual(parse({ tags: ['后坐力稳', '消音', '满改神器', '新手推荐'] }), {
    ok: false,
    field: 'tags',
  })
  assert.deepEqual(parse({ price: '-3' }), { ok: false, field: 'price' })
  assert.deepEqual(parse({ distance: '' }), { ok: false, field: 'stats' }, 'stats are all or none')
  const bare = parse({
    mode: 'warfare',
    recoil: '',
    handling: '',
    stability: '',
    hipfire: '',
    distance: '',
  }).value
  assert.equal(bare.price, null, 'warfare builds carry no price')
  assert.equal(bare.stats, null)

  const valid = parse({}).value
  assert.deepEqual(await submit(accountIds.owner, valid), { ok: false, reason: 'closed' })
  database.prepare('UPDATE game SET loadout_codes = 1 WHERE id = 71').run()
  assert.equal((await submit(accountIds.owner, valid, now, 'loadouts/a.webp')).ok, true)
  assert.deepEqual(await submit(accountIds.manager, valid), { ok: false, reason: 'duplicate' })
  for (let index = 1; index < 5; index += 1) {
    assert.equal((await submit(accountIds.owner, valueWith(codeAt(index)))).ok, true)
  }
  assert.deepEqual(await submit(accountIds.owner, valueWith(codeAt(9))), {
    ok: false,
    reason: 'limit',
  })
  assert.throws(() =>
    database
      .prepare(
        `INSERT INTO loadout_code (game_id, account_id, mode, weapon, code, title, status,
           created_at, reviewed_at)
         VALUES (71, ?, 'operations', 'AK', ?, 'direct', 'approved', 1, 1)`,
      )
      .run(accountIds.manager, codeAt(20)),
  )
  assert.throws(
    () =>
      database
        .prepare(
          `INSERT INTO loadout_code (game_id, account_id, mode, weapon, code, title, price, created_at)
           VALUES (71, ?, 'warfare', 'AK', ?, 'priced', 10, 1)`,
        )
        .run(accountIds.manager, codeAt(21)),
    /CHECK constraint failed/,
  )

  const { pending } = await listLoadoutCodesForReview(db)
  assert.equal(pending.length, 5)
  assert.deepEqual(pending[0].stats, valid.stats)
  assert.deepEqual(pending[0].tags, valid.tags)
  assert.equal(pending[0].shotKey, 'loadouts/a.webp')
  assert.equal(pending[0].gameSlug, 'identity-kernel')
  assert.deepEqual(await listLoadoutCodes(db, 71), [])
  const [first, second, third] = pending
  assert.equal(
    await reportLoadoutCode(db, { id: first.id, accountId: accountIds.manager }, now),
    false,
  )
  assert.deepEqual(await review(first.id, 'approved', now + 1), {
    ok: true,
    gameSlug: 'identity-kernel',
  })
  assert.deepEqual(
    await review(first.id, 'rejected', now + 2),
    { ok: false },
    'decisions are final',
  )
  assert.deepEqual(await review(second.id, 'expired', now + 2), { ok: false })
  await review(second.id, 'rejected', now + 3)
  await review(third.id, 'approved', now + 4)

  await recordLoadoutCopy(db, first.id)
  await recordLoadoutCopy(db, first.id)
  await recordLoadoutCopy(db, second.id)
  for (const accountId of [accountIds.manager, accountIds.reviewer, accountIds.manager]) {
    assert.equal(await reportLoadoutCode(db, { id: first.id, accountId }, now + 5), true)
  }
  assert.deepEqual([...(await listViewerLoadoutMarks(db, accountIds.manager)).reported], [first.id])
  const { reported } = await listLoadoutCodesForReview(db)
  assert.deepEqual(
    reported.map(code => [code.id, code.reports, code.copies]),
    [[first.id, 2, 2]],
  )
  assert.deepEqual(await review(first.id, 'dismiss', now + 6), {
    ok: true,
    gameSlug: 'identity-kernel',
  })
  assert.deepEqual((await listLoadoutCodesForReview(db)).reported, [])
  assert.deepEqual(await review(third.id, 'expired', now + 7), {
    ok: true,
    gameSlug: 'identity-kernel',
  })
  assert.equal(
    await reportLoadoutCode(db, { id: third.id, accountId: accountIds.manager }, now),
    false,
  )
  assert.deepEqual(
    (await listLoadoutCodes(db, 71)).map(code => [code.code, code.status]),
    [
      [third.code, 'expired'],
      [CODE, 'approved'],
    ],
  )
  assert.deepEqual(
    (await listOwnLoadoutCodes(db, accountIds.owner, 71)).map(code => code.status).sort(),
    ['approved', 'expired', 'pending', 'pending', 'rejected'],
  )
  assert.equal((await submit(accountIds.owner, valueWith(codeAt(9)))).ok, true)
  assert.equal((await listOwnLoadoutCodes(db, accountIds.owner)).length, 6)
  assert.deepEqual(await listOwnLoadoutCodes(db, accountIds.owner, 72), [])

  const like = (id, accountId, liked) => setLoadoutLike(db, { id, accountId, liked }, now)
  assert.equal(await like(first.id, accountIds.manager, true), true)
  assert.equal(await like(first.id, accountIds.manager, true), true, 'liking twice is idempotent')
  assert.equal(await like(first.id, accountIds.reviewer, true), true)
  assert.equal(
    await like(third.id, accountIds.manager, true),
    false,
    'expired builds take no likes',
  )
  assert.equal(await like(first.id, accountIds.reviewer, false), true)
  assert.deepEqual([...(await listViewerLoadoutMarks(db, accountIds.manager)).liked], [first.id])
  const detail = await getLoadoutCode(db, 71, first.id)
  assert.deepEqual([detail.likes, detail.comments, detail.gameSlug], [1, 0, 'identity-kernel'])
  assert.equal(await getLoadoutCode(db, 71, second.id), null, 'rejected builds have no page')
  assert.deepEqual(
    (await listAuthorLoadoutCodes(db, accountIds.owner)).map(code => code.id),
    [first.id],
  )

  assert.equal(parseLoadoutComment('  好用\r\n换了枪口  '), '好用\n换了枪口')
  assert.equal(parseLoadoutComment(' '), null)
  assert.equal(parseLoadoutComment('x'.repeat(301)), null)
  const comment = (id, accountId, at = now) =>
    postLoadoutComment(db, { id, accountId, body: '手感不错' }, at)
  assert.deepEqual(await comment(second.id, accountIds.manager), { ok: false, reason: 'closed' })
  assert.deepEqual(await comment(third.id, accountIds.manager), { ok: true })
  for (let index = 0; index < 9; index += 1) {
    assert.deepEqual(await comment(first.id, accountIds.manager, now + index), { ok: true })
  }
  assert.deepEqual(await comment(first.id, accountIds.manager, now + 10), {
    ok: false,
    reason: 'limit',
  })
  assert.deepEqual(await comment(first.id, accountIds.manager, now + 3_600_001), { ok: true })
  assert.deepEqual(await comment(first.id, accountIds.reviewer), { ok: true })
  const thread = await listLoadoutComments(db, first.id, false)
  assert.equal(thread.length, 11)
  const remove = (commentId, accountId, moderator) =>
    removeLoadoutComment(db, { commentId, accountId, moderator }, now)
  const reviewerComment = thread.find(entry => entry.authorId === accountIds.reviewer)
  assert.equal(await remove(reviewerComment.id, accountIds.manager, false), false)
  assert.equal(await remove(thread[0].id, accountIds.manager, false), true)
  assert.equal(await remove(reviewerComment.id, accountIds.platformOwner, true), true)
  assert.equal(await remove(reviewerComment.id, accountIds.platformOwner, true), false)
  assert.equal((await listLoadoutComments(db, first.id, false)).length, 9)
  const moderated = await listLoadoutComments(db, first.id, true)
  assert.deepEqual(
    moderated.filter(entry => entry.hidden).map(entry => entry.id),
    [reviewerComment.id],
  )
  assert.equal((await getLoadoutCode(db, 71, first.id)).comments, 9)

  const origin = 'https://club.test'
  const digest = await loadoutDigest(db, 'm4', origin)
  assert.equal(
    digest,
    [
      '热门改枪码 · M4A1',
      `1. 低后坐 · 约32.5w · 复制 2`,
      `M4A1突击步枪-烽火地带-${CODE}`,
      `${origin}/games/identity-kernel/loadouts?class=%E6%AD%A5%E6%9E%AA&weapon=M4A1%E7%AA%81%E5%87%BB%E6%AD%A5%E6%9E%AA`,
    ].join('\n'),
  )
  assert.match(await loadoutDigest(db, '全面', origin), /^还没有「全面战场」的改枪码/)
  assert.match(await loadoutDigest(db, '水枪', origin), /^没认出「水枪」/)
  assert.match(await loadoutDigest(db, '', origin), /^热门改枪码\n1\. 低后坐/)

  console.log('loadout code tests passed')
} finally {
  database.close()
}

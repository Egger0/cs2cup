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

const { normalizeOfficialLoadout } = await import('../lib/loadout-official.ts')
const { syncOfficialLoadouts } = await import('../lib/loadout-official-sync.ts')
const { loadoutFacets } = await import('../lib/loadout-facets.ts')
const { getLoadoutCode, listLoadoutAccessories, queryLoadoutCodes, randomLoadoutId } =
  await import('../lib/loadout-queries.ts')
const { submitLoadoutCode } = await import('../lib/loadout-codes.ts')
const { listSavedLoadouts, listViewerLoadoutMarks, setLoadoutFavorite, setLoadoutFeatured } =
  await import('../lib/loadout-community.ts')
const { loadoutDigest } = await import('../lib/loadout-reach.ts')
const { default: fixture } = await import('./fixtures/delta-official.mjs')
const { accountIds, createIdentityKernelFixture } =
  await import('./identity-kernel-test-fixture.mjs')

const [m700, fastThompson, cheapThompson, bare] = fixture.solutions
const official = normalizeOfficialLoadout(m700)
assert.equal(official.officialId, 12825)
assert.equal(official.mode, 'operations')
assert.equal(official.weapon, 'M700狙击步枪')
assert.equal(official.code, '6L8CPOS04C9NGO2DGDCB8')
assert.equal(official.authorName, 'eStar丨Aqing')
assert.equal(official.authorChannel, 'douyin')
assert.equal(official.note, '极致开镜速度，稳准狠')
assert.deepEqual(official.stats, {
  recoil: 37,
  handling: 48,
  stability: 69,
  hipfire: 23,
  distance: 204,
})
assert.deepEqual(official.baseStats, {
  recoil: 24,
  handling: 48,
  stability: 70,
  hipfire: 27,
  distance: 150,
})
assert.match(official.renderUrl, /^https:\/\/playerhub\.df\.qq\.com\//)
assert.equal(official.accessories.length, 3)
assert.equal(new Date(official.createdAt).toISOString(), '2026-09-10T15:44:27.000Z')
assert.equal(normalizeOfficialLoadout(bare).mode, 'operations', 'bare codes default to operations')
assert.equal(
  normalizeOfficialLoadout({ ...m700, previewPic: 'https://evil.test/x.png' }).renderUrl,
  null,
)
assert.equal(normalizeOfficialLoadout({ ...m700, solutionCode: 'nothing' }), null)

const respond = data =>
  new Response(JSON.stringify({ ret: 0, jData: { data: { data } } }), {
    headers: { 'content-type': 'application/json' },
  })
const fetcherFor =
  (solutions, { fail = false } = {}) =>
  async input => {
    const url = new URL(input)
    const method = url.searchParams.get('method')
    const param = JSON.parse(url.searchParams.get('param'))
    if (method === 'dfm/object.list') {
      return respond({ list: param.primary === 'gun' ? fixture.guns : fixture.accessories })
    }
    if (fail && param.page === 2) return new Response('busy', { status: 502 })
    return respond({ list: param.page === 1 ? solutions : null })
  }

const { database, db, now } = await createIdentityKernelFixture()
const count = sql => database.prepare(sql).get().count
try {
  assert.deepEqual(await syncOfficialLoadouts(db, fetcherFor(fixture.solutions), now), {
    skipped: true,
  })
  database.prepare('UPDATE game SET loadout_codes = 1 WHERE id = 71').run()
  const member = await submitLoadoutCode(
    db,
    {
      accountId: accountIds.owner,
      gameId: 71,
      shotKey: 'loadouts/member.webp',
      value: {
        code: '6L79CCC0BK4JN1CPUVQAH',
        mode: 'operations',
        weapon: '汤姆逊冲锋枪',
        title: '社员汤姆逊',
        note: null,
        tags: [],
        price: null,
        stats: { recoil: 60, handling: 70, stability: 50, hipfire: 70, distance: 30 },
      },
    },
    now,
  )
  database
    .prepare(`UPDATE loadout_code SET status = 'approved', reviewed_at = ? WHERE id = ?`)
    .run(now, member.id)

  assert.deepEqual(await syncOfficialLoadouts(db, fetcherFor(fixture.solutions), now + 1), {
    skipped: false,
    solutions: 2,
    expired: 0,
    complete: true,
  })
  assert.equal(count(`SELECT COUNT(*) AS count FROM loadout_weapon`), 2)
  assert.equal(count(`SELECT COUNT(*) AS count FROM loadout_accessory`), 2)
  assert.deepEqual(
    database
      .prepare(
        `SELECT official_id AS id, title FROM loadout_code WHERE source = 'official' ORDER BY id`,
      )
      .all()
      .map(row => ({ ...row })),
    [
      {
        id: fastThompson.applyNum >= cheapThompson.applyNum ? 12820 : 12819,
        title:
          fastThompson.applyNum >= cheapThompson.applyNum ? fastThompson.name : cheapThompson.name,
      },
      { id: 12825, title: '稳准狠M700' },
    ],
    'duplicate bodies keep the most applied plan and member codes are never overwritten',
  )

  const again = await syncOfficialLoadouts(db, fetcherFor(fixture.solutions), now + 2)
  assert.equal(again.solutions, 2)
  assert.equal(count(`SELECT COUNT(*) AS count FROM loadout_code WHERE source = 'official'`), 2)

  const { codes, total } = await queryLoadoutCodes(
    db,
    71,
    { source: 'official' },
    { sort: 'usage', limit: 10 },
  )
  assert.equal(total, 2)
  assert.ok(codes[0].applyCount >= codes[1].applyCount, 'usage sort follows game usage')
  const detail = codes.find(code => code.code === official.code)
  assert.deepEqual(detail.stats, official.stats)
  assert.deepEqual(detail.baseStats, official.baseStats)
  assert.deepEqual(detail.maps, official.maps)
  assert.deepEqual(
    (await listLoadoutAccessories(db, detail.accessories)).map(item => item.id),
    [13030000111, 13110000082],
    'accessories keep build order and skip unknown objects',
  )

  const memberView = await getLoadoutCode(db, 71, member.id)
  assert.equal(memberView.source, 'member')
  assert.deepEqual(
    Object.keys(memberView.baseStats).sort(),
    ['distance', 'handling', 'hipfire', 'recoil', 'stability'],
    'member builds borrow base stats from the synced weapon',
  )

  const facets = await loadoutFacets(db, 71, { mode: 'operations', source: null })
  assert.deepEqual(facets.groups.map(group => [group.source, group.count]).sort(), [
    ['member', 1],
    ['official', 2],
  ])
  assert.ok(facets.maps.length > 0)
  assert.ok(facets.weapons.every(weapon => weapon.category))

  await assert.rejects(syncOfficialLoadouts(db, fetcherFor([bare], { fail: true }), now + 3))
  assert.equal(
    count(
      `SELECT COUNT(*) AS count FROM loadout_code WHERE source = 'official' AND status = 'expired'`,
    ),
    0,
    'a failed sync never expires the library',
  )
  const pruned = await syncOfficialLoadouts(db, fetcherFor([m700]), now + 4)
  assert.equal(pruned.expired, 1)
  assert.equal((await queryLoadoutCodes(db, 71, { source: 'official' }, { limit: 10 })).total, 1)

  const save = (id, saved) =>
    setLoadoutFavorite(db, { id, accountId: accountIds.manager, saved }, now)
  assert.equal(await save(detail.id, true), true)
  assert.equal(await save(detail.id, true), true, 'saving twice is idempotent')
  assert.equal(await save(999999, true), false)
  assert.deepEqual([...(await listViewerLoadoutMarks(db, accountIds.manager)).saved], [detail.id])
  assert.deepEqual(
    (await queryLoadoutCodes(db, 71, { savedBy: accountIds.manager }, { limit: 10 })).codes.map(
      code => code.id,
    ),
    [detail.id],
  )
  assert.equal((await listSavedLoadouts(db, accountIds.manager))[0].title, '稳准狠M700')
  assert.equal(await save(detail.id, false), true)
  assert.deepEqual(await listSavedLoadouts(db, accountIds.manager), [])

  assert.equal(
    await setLoadoutFeatured(db, { id: member.id, featured: true }, now + 5),
    'identity-kernel',
  )
  const picks = await queryLoadoutCodes(db, 71, { featured: true }, { sort: 'featured', limit: 3 })
  assert.deepEqual(
    picks.codes.map(code => [code.id, code.featuredAt]),
    [[member.id, now + 5]],
  )
  await setLoadoutFeatured(db, { id: member.id, featured: false }, now + 6)
  assert.equal((await queryLoadoutCodes(db, 71, { featured: true }, { limit: 3 })).total, 0)

  assert.equal(
    await randomLoadoutId(db, 71, { weapons: ['M700狙击步枪'] }),
    detail.id,
    'random picks respect filters',
  )
  assert.equal(await randomLoadoutId(db, 71, { weapons: ['复合弓'] }), null)
  assert.match(await loadoutDigest(db, '随机', 'https://club.test'), /^随机来一把：/)

  console.log('loadout official library tests passed')
} finally {
  database.close()
}

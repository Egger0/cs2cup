import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

import { createMigratedDatabase } from './sqlite-fixture.mjs'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only' || specifier === './identity/internal/contracts.ts') {
      return { url: 'data:text/javascript,export {}', shortCircuit: true }
    }
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith('.') || /\.[a-z]+$/i.test(specifier)) throw error
      return nextResolve(`${specifier}.ts`, context)
    }
  },
})

function d1Adapter(database) {
  return {
    prepare(query) {
      const statement = database.prepare(query)
      return {
        bind: (...values) => ({
          first: async () => statement.get(...values) ?? null,
          all: async () => ({ results: statement.all(...values) }),
          run: async () => statement.run(...values),
        }),
      }
    },
  }
}

const token = character => character.repeat(43)
const [ALICE, BOB, QUIET] = [token('a'), token('b'), token('c')]
const database = await createMigratedDatabase()
const db = d1Adapter(database)
const { followedHandles, followerCount, getBio, parseBio, setBio, setPlayerFollow } =
  await import('../lib/player-social.ts')

try {
  for (const [id, seed, name, handle] of [
    [ALICE, 'x', 'Alice', "'alice'"],
    [BOB, 'y', 'Bob', "'bob'"],
    [QUIET, 'z', 'Quiet', 'NULL'],
  ]) {
    database.exec(
      `INSERT INTO identity_account (id, webauthn_user_handle, display_name, status, verification_state, public_handle)
       VALUES ('${id}', '${token(seed)}', '${name}', 'active', 'verified', ${handle})`,
    )
  }

  assert.deepEqual(parseBio('  hello   world '), { ok: true, bio: 'hello world' })
  assert.deepEqual(parseBio('   '), { ok: true, bio: null })
  assert.equal(parseBio('x'.repeat(121)), null)

  await setBio(db, ALICE, 'first', 1)
  await setBio(db, ALICE, 'second', 2)
  assert.equal(await getBio(db, ALICE), 'second')
  await setBio(db, ALICE, null, 3)
  assert.equal(await getBio(db, ALICE), null)

  assert.deepEqual(
    await setPlayerFollow(db, { followerId: ALICE, handle: 'bob', follow: true }, 5),
    { ok: true },
  )
  await setPlayerFollow(db, { followerId: ALICE, handle: 'bob', follow: true }, 6)
  assert.deepEqual(await followedHandles(db, ALICE), ['bob'])
  assert.equal(await followerCount(db, BOB), 1)
  assert.deepEqual(
    await setPlayerFollow(db, { followerId: ALICE, handle: 'alice', follow: true }, 7),
    {
      ok: false,
      reason: 'self',
    },
  )
  assert.deepEqual(
    await setPlayerFollow(db, { followerId: ALICE, handle: 'nobody', follow: true }, 7),
    {
      ok: false,
      reason: 'not_found',
    },
  )
  assert.deepEqual(
    await setPlayerFollow(db, { followerId: BOB, handle: 'quiet', follow: true }, 7),
    {
      ok: false,
      reason: 'not_found',
    },
  )
  await setPlayerFollow(db, { followerId: ALICE, handle: 'bob', follow: false }, 8)
  assert.equal(await followerCount(db, BOB), 0)
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  database.close()
}
if (!process.exitCode) console.log('player social tests passed')

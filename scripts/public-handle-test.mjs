import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
const cookiesModule = dataModule(`
  export async function cookies() { throw new Error('Unexpected cookie access') }
`)
const bindingsModule = dataModule(`
  export function cloudflareBindings() { throw new Error('Unexpected production binding') }
`)

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') {
      return { url: dataModule('export {}'), shortCircuit: true }
    }
    if (specifier === 'next/headers') return { url: cookiesModule, shortCircuit: true }
    if (specifier === '../cloudflare-bindings.ts') {
      return { url: bindingsModule, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const { normalisePublicHandle, setPublicHandle } = await import('../lib/identity/public-handle.ts')
const { accountIds, createIdentityKernelFixture, credentialIds } =
  await import('./identity-kernel-test-fixture.mjs')

assert.equal(normalisePublicHandle(' Aster '), 'aster')
assert.equal(normalisePublicHandle('FLINT-Two'), 'flint-two')

const fixture = await createIdentityKernelFixture()
try {
  const { context } = await fixture.session(accountIds.owner, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.owner,
  })

  const stored = () =>
    fixture.database
      .prepare('SELECT public_handle FROM identity_account WHERE id = ?')
      .get(accountIds.owner).public_handle

  assert.deepEqual(await setPublicHandle(fixture.db, context, ' Aster ', fixture.now + 1), {
    ok: true,
    handle: 'aster',
  })
  assert.equal(stored(), 'aster', 'the normalised handle is what gets stored')

  for (const [value, reason] of [
    ['a s', 'invalid'],
    ['aster_one', 'invalid'],
    ['-aster', 'invalid'],
    ['aster-', 'invalid'],
    ['fl', 'invalid'],
    ['a'.repeat(31), 'invalid'],
    ['admin', 'reserved'],
    ['players', 'reserved'],
    ['Tournaments', 'reserved'],
  ]) {
    assert.deepEqual(
      await setPublicHandle(fixture.db, context, value, fixture.now + 2),
      { ok: false, reason },
      `${value} must be refused as ${reason}`,
    )
  }
  assert.equal(stored(), 'aster', 'a refused handle must not disturb the stored one')

  const revision = () =>
    fixture.database
      .prepare('SELECT revision FROM identity_account WHERE id = ?')
      .get(accountIds.owner).revision
  const before = revision()
  assert.deepEqual(await setPublicHandle(fixture.db, context, 'aster', fixture.now + 3), {
    ok: true,
    handle: 'aster',
  })
  assert.equal(revision(), before, 'setting the same handle again must not write')

  assert.deepEqual(await setPublicHandle(fixture.db, context, null, fixture.now + 4), {
    ok: true,
    handle: null,
  })
  assert.equal(stored(), null, 'clearing the handle unpublishes the page')

  console.log('public handle service tests passed')
} finally {
  fixture.database.close()
}

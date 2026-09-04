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
    if (specifier === '../cloudflare-bindings.ts')
      return { url: bindingsModule, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

const { updateAccountDisplayName } = await import('../lib/identity/account-profile.ts')
const { accountIds, createIdentityKernelFixture, credentialIds } =
  await import('./identity-kernel-test-fixture.mjs')

const fixture = await createIdentityKernelFixture()
try {
  const { context } = await fixture.session(accountIds.owner, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.owner,
  })
  assert.deepEqual(
    await updateAccountDisplayName(fixture.db, context, '新的显示名称', fixture.now + 1),
    { ok: true, displayName: '新的显示名称' },
  )
  assert.equal(
    fixture.database
      .prepare('SELECT display_name FROM identity_account WHERE id = ?')
      .get(accountIds.owner).display_name,
    '新的显示名称',
  )
  assert.deepEqual(
    await updateAccountDisplayName(fixture.db, context, ' 两侧空格 ', fixture.now + 2),
    { ok: true, displayName: '两侧空格' },
  )
  assert.deepEqual(
    await updateAccountDisplayName(fixture.db, context, '无效\u202e名称', fixture.now + 3),
    { ok: false, reason: 'invalid_input' },
  )
} finally {
  fixture.database.close()
}

console.log('identity account profile tests passed')

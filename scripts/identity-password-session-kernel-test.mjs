import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
const cookiesModule = dataModule(`
  export async function cookies() { throw new Error('Unexpected cookie transport in kernel test') }
`)
const bindingsModule = dataModule(`
  export function cloudflareBindings() { throw new Error('Unexpected production binding in kernel test') }
`)
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: dataModule('export {}'), shortCircuit: true }
    if (specifier === 'next/headers') return { url: cookiesModule, shortCircuit: true }
    if (specifier === '../cloudflare-bindings.ts') {
      return { url: bindingsModule, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const { createSessionDraft, getAuthContext, sessionInsertStatement } =
  await import('../lib/identity/kernel.ts')
const { accountIds, createIdentityKernelFixture, opaque, passwordCredentialIds } =
  await import('./identity-kernel-test-fixture.mjs')

const fixture = await createIdentityKernelFixture()
const { database, db, execute, now } = fixture
const accountId = accountIds.weakStaff
const credentialId = passwordCredentialIds.weakStaff

try {
  const verificationNonce = fixture.createPasswordProof(accountId, credentialId, now)
  const mismatchedNonce = verificationNonce === opaque('z') ? opaque('y') : opaque('z')
  const staleProof = await createSessionDraft({
    accountId,
    authentication: {
      method: 'password',
      passwordCredentialId: credentialId,
      verificationNonce: mismatchedNonce,
    },
    now,
  })
  assert.equal(
    await sessionInsertStatement(db, staleProof).first(),
    null,
    'a session cannot reuse an authentication timestamp without its exact CAS nonce',
  )
  const draft = await createSessionDraft({
    accountId,
    authentication: {
      method: 'password',
      passwordCredentialId: credentialId,
      verificationNonce,
    },
    now,
  })
  assert.equal((await sessionInsertStatement(db, draft).first()).id, draft.record.id)
  assert.equal(
    database
      .prepare('SELECT password_verification_nonce FROM identity_session WHERE id = ?')
      .get(draft.record.id).password_verification_nonce,
    verificationNonce,
  )
  const context = await getAuthContext({ database: db, token: draft.token, now })
  assert.equal(context.kind, 'authenticated')
  assert.equal(context.session.authMethod, 'password')
  assert.equal(context.session.phishingResistantAt, null)

  execute(
    `UPDATE identity_password_credential
     SET failed_attempt_count = 1, last_failed_at = ?, locked_until = ?,
         updated_at = ?, revision = revision + 1, write_nonce = ? WHERE id = ?`,
    [now + 10, now + 100, now + 10, opaque('b'), credentialId],
  )
  assert.equal(
    (await getAuthContext({ database: db, token: draft.token, now: now + 11 })).kind,
    'authenticated',
    'login throttling must not let an attacker terminate an already-valid browser session',
  )

  execute(
    `UPDATE identity_password_credential
     SET status = 'revoked', revoked_at = ?, updated_at = ?,
         revision = revision + 1, write_nonce = ? WHERE id = ?`,
    [now + 20, now + 20, opaque('c'), credentialId],
  )
  assert.equal(
    (await getAuthContext({ database: db, token: draft.token, now: now + 21 })).kind,
    'anonymous',
    'revoking the password credential must invalidate sessions on their next use',
  )
  console.log('unified password session provenance tests passed')
} finally {
  database.close()
}

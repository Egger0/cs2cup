import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
const cookiesModule = dataModule(
  `export async function cookies() { throw new Error('Unexpected cookie transport') }`,
)
const bindingsModule = dataModule(
  `export function cloudflareBindings() { throw new Error('Unexpected production binding') }`,
)
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

const {
  attachLegacyRegistration,
  deleteOwnedRegistration,
  listAccountTournamentRegistrations,
  RegistrationWorkflowError,
} = await import('../lib/identity/registration-workflow.ts')
const { hashRegistrationToken } = await import('../lib/registration-access.ts')
const { accountIds, createIdentityKernelFixture, credentialIds, opaque } =
  await import('./identity-kernel-test-fixture.mjs')

const fixture = await createIdentityKernelFixture()
const { database, db, execute, now } = fixture
const passkey = name => ({
  method: 'passkey',
  authenticatorCredentialId: credentialIds[name],
})
const expectWorkflowError = (operation, code) =>
  assert.rejects(operation, error => {
    assert.equal(error instanceof RegistrationWorkflowError, true)
    assert.equal(error.code, code)
    return true
  })

try {
  const owner = await fixture.session(accountIds.owner, passkey('owner'))
  const manager = await fixture.session(accountIds.manager, passkey('manager'))
  const ownerEntries = await listAccountTournamentRegistrations(db, owner.context, now)
  assert.deepEqual(
    ownerEntries.map(entry => [entry.team.id, entry.relationship]),
    [[711, 'owner']],
  )
  assert.deepEqual(
    (await listAccountTournamentRegistrations(db, manager.context, now)).map(entry => [
      entry.team.id,
      entry.relationship,
    ]),
    [
      [722, 'owner'],
      [711, 'manager'],
    ],
  )

  await expectWorkflowError(
    () => deleteOwnedRegistration(db, manager.context, 711, now),
    'forbidden',
  )
  const staleOwner = await fixture.session(accountIds.owner, passkey('owner'), now - 16 * 60 * 1000)
  await expectWorkflowError(
    () => deleteOwnedRegistration(db, staleOwner.context, 711, now),
    'reauth_required',
  )

  const token = opaque('z')
  const tokenHash = await hashRegistrationToken(token)
  execute(
    `INSERT INTO team
      (id, tournament_id, name, tag, captain, contact, status, management_token_hash)
     VALUES (723, 72, 'Legacy Team', 'LEG', 'Captain', 'private', 'pending', ?)`,
    [tokenHash],
  )
  assert.deepEqual(
    await attachLegacyRegistration(db, owner.context, { slug: 'kernel-two', token, now: now + 11 }),
    { teamId: 723 },
  )
  assert.deepEqual(
    await attachLegacyRegistration(db, owner.context, { slug: 'kernel-two', token, now: now + 12 }),
    { teamId: 723 },
  )
  assert.equal(
    database.prepare('SELECT management_token_hash FROM team WHERE id = 723').get()
      .management_token_hash,
    null,
  )
  const laterOwner = await fixture.session(
    accountIds.owner,
    passkey('owner'),
    now + 15 * 60 * 1000 + 20,
  )
  await expectWorkflowError(
    () =>
      attachLegacyRegistration(db, laterOwner.context, {
        slug: 'kernel-two',
        token,
        now: now + 15 * 60 * 1000 + 21,
      }),
    'not_found',
  )

  await deleteOwnedRegistration(db, manager.context, 722, now + 13)
  assert.equal(database.prepare('SELECT 1 FROM team WHERE id = 722').get(), undefined)

  console.log('identity registration workflow tests passed')
} finally {
  database.close()
}

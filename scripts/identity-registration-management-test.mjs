import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
const cookiesModule = dataModule(
  `export async function cookies() { throw new Error('Unexpected cookie transport') }`,
)
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: dataModule('export {}'), shortCircuit: true }
    if (specifier === 'next/headers') return { url: cookiesModule, shortCircuit: true }
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith('.') || /\.[a-z]+$/i.test(specifier)) throw error
      return nextResolve(`${specifier}.ts`, context)
    }
  },
})

const { getAccountManagedRegistration, saveAccountManagedRegistration } =
  await import('../lib/queries/registration-account-management.ts')
const { RegistrationManagementError } =
  await import('../lib/queries/registration-management-model.ts')
const { accountIds, createIdentityKernelFixture, opaque, passwordCredentialIds } =
  await import('./identity-kernel-test-fixture.mjs')

const fixture = await createIdentityKernelFixture()
const { database, db, execute, now } = fixture
const expectError = (operation, code) =>
  assert.rejects(operation, error => {
    assert.equal(error instanceof RegistrationManagementError, true)
    assert.equal(error.code, code)
    return true
  })

try {
  const reviewer = await fixture.session(accountIds.reviewer, {
    method: 'password',
    passwordCredentialId: passwordCredentialIds.reviewer,
  })
  const unrelated = await fixture.session(accountIds.weakStaff, {
    method: 'password',
    passwordCredentialId: passwordCredentialIds.weakStaff,
  })
  execute(
    `INSERT INTO identity_registration_membership
      (id, team_id, account_id, relationship, granted_by_account_id, grant_reason, granted_at)
     VALUES (?, 722, ?, 'manager', ?, 'Workflow edit test', ?)`,
    [opaque('j'), accountIds.reviewer, accountIds.manager, now - 1],
  )

  const view = await getAccountManagedRegistration(db, reviewer.context, 722, now)
  assert.equal(view.relationship, 'manager')
  assert.equal(view.editable, true)
  const values = {
    name: 'Kernel Bravo Updated',
    tag: 'KBU',
    captain: 'Bravo',
    contact: 'bravo@example.test',
    dept: null,
    note: null,
    players: Array.from({ length: 5 }, (_, index) => ({
      nickname: `Bravo ${index + 1}`,
      substitute: false,
    })),
  }
  const edited = await saveAccountManagedRegistration(
    db,
    reviewer.context,
    722,
    view.revision,
    values,
    now,
  )
  assert.equal(edited.revision, view.revision + 1)
  await expectError(
    () => saveAccountManagedRegistration(db, reviewer.context, 722, view.revision, values, now),
    'conflict',
  )
  await expectError(
    () => getAccountManagedRegistration(db, unrelated.context, 722, now),
    'forbidden',
  )
  console.log('identity account registration management tests passed')
} finally {
  database.close()
}

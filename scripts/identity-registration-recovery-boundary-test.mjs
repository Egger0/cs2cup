import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: dataModule('export {}'), shortCircuit: true }
    if (specifier === 'next/headers') {
      return {
        url: dataModule(`export async function cookies() { throw new Error('no cookies') }`),
        shortCircuit: true,
      }
    }
    if (specifier === '../cloudflare-bindings.ts') {
      return {
        url: dataModule(`export function cloudflareBindings() { throw new Error('no binding') }`),
        shortCircuit: true,
      }
    }
    return nextResolve(specifier, context)
  },
})

const workflow = await import('../lib/identity/registration-workflow.ts')
const { accountIds, createIdentityKernelFixture, credentialIds, opaque } =
  await import('./identity-kernel-test-fixture.mjs')
const fixture = await createIdentityKernelFixture()
const { database, db, execute, now } = fixture
const expectedFailure = operation =>
  assert.rejects(
    operation,
    error =>
      error instanceof workflow.RegistrationWorkflowError && error.code === 'reauth_required',
  )
const values = {
  name: 'Restricted Draft',
  tag: 'LOCK',
  captain: 'Captain',
  contact: 'private@example.test',
  dept: '',
  note: '',
  players: ['One', 'Two', 'Three', 'Four', 'Five', ''],
}

try {
  const recovery = await fixture.session(accountIds.recovery, {
    method: 'oidc',
    recovery: { authIntentId: fixture.createRecoveryProof() },
  })
  const restrictedOperations = [
    () => workflow.getRegistrationDraft(db, recovery.context, 'kernel-two', now),
    () => workflow.listRegistrationDrafts(db, recovery.context, now),
    () => workflow.listAccountTournamentRegistrations(db, recovery.context, now),
    () => workflow.listIncomingRegistrationInvitations(db, recovery.context, now),
    () => workflow.accountRegistrationRelationship(db, recovery.context, 711, now),
    () => workflow.saveRegistrationDraft(db, recovery.context, { tournamentId: 72, values, now }),
    () => workflow.acceptRegistrationInvitation(db, recovery.context, opaque('I'), now),
    () =>
      workflow.attachLegacyRegistration(db, recovery.context, {
        slug: 'kernel-two',
        token: opaque('L'),
        now,
      }),
  ]
  for (const operation of restrictedOperations) await expectedFailure(operation)
  assert.equal(
    database
      .prepare('SELECT COUNT(*) AS count FROM identity_registration_draft WHERE account_id = ?')
      .get(accountIds.recovery).count,
    0,
  )

  const revoked = await fixture.session(accountIds.owner, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.owner,
  })
  execute(
    `UPDATE identity_session SET revoked_at = ?, revoke_reason = 'boundary test',
       revision = revision + 1, write_nonce = ? WHERE id = ?`,
    [now, opaque('N'), revoked.context.session.id],
  )
  await expectedFailure(() =>
    workflow.saveRegistrationDraft(db, revoked.context, { tournamentId: 72, values, now }),
  )
  console.log('identity registration recovery boundary tests passed')
} finally {
  database.close()
}

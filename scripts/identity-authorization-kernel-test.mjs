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

const { authorize, revokeSession } = await import('../lib/identity/kernel.ts')
const { accountIds, createIdentityKernelFixture, credentialIds, opaque, passwordCredentialIds } =
  await import('./identity-kernel-test-fixture.mjs')

const fixture = await createIdentityKernelFixture()
const { database, db, now } = fixture

async function decision(context, capability, resource, options = {}) {
  return authorize(context, capability, resource, { database: db, now, ...options })
}

try {
  const owner = await fixture.session(accountIds.owner, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.owner,
  })
  const manager = await fixture.session(accountIds.manager, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.manager,
  })
  const platformOwner = await fixture.session(accountIds.platformOwner, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.platformOwner,
  })
  const staleNonPasskeyStaff = await fixture.session(
    accountIds.weakStaff,
    { method: 'password', passwordCredentialId: passwordCredentialIds.weakStaff },
    now - 13 * 60 * 60 * 1000,
  )
  const nonPasskeyStaff = await fixture.session(accountIds.weakStaff, {
    method: 'password',
    passwordCredentialId: passwordCredentialIds.weakStaff,
  })
  const reviewer = await fixture.session(accountIds.reviewer, {
    method: 'password',
    passwordCredentialId: passwordCredentialIds.reviewer,
  })

  assert.equal(
    (
      await decision(owner.context, 'registration.view', {
        kind: 'registration',
        registrationId: 711,
      })
    ).ok,
    true,
  )
  assert.equal(
    (
      await decision(manager.context, 'registration.edit', {
        kind: 'registration',
        registrationId: 711,
      })
    ).ok,
    true,
  )
  assert.deepEqual(
    await decision(manager.context, 'registration.transfer', {
      kind: 'registration',
      registrationId: 711,
    }),
    { ok: false, reason: 'forbidden' },
  )
  assert.deepEqual(
    await decision(owner.context, 'registration.edit', {
      kind: 'registration',
      registrationId: 722,
    }),
    { ok: false, reason: 'forbidden' },
  )
  assert.deepEqual(
    await decision(platformOwner.context, 'registration.delete', {
      kind: 'registration',
      registrationId: 711,
    }),
    { ok: false, reason: 'forbidden' },
    'a staff role must not silently become participant ownership',
  )

  const derived = await decision(owner.context, 'tournament.entries.review', {
    kind: 'registration',
    registrationId: 711,
  })
  assert.deepEqual(derived, {
    ok: true,
    accountId: accountIds.owner,
    capability: 'tournament.entries.review',
    resource: { kind: 'registration', registrationId: 711, tournamentId: 71 },
    assurance: 'recent',
  })
  assert.deepEqual(
    await decision(owner.context, 'tournament.entries.review', {
      kind: 'registration',
      registrationId: 722,
      tournamentId: 71,
    }),
    { ok: false, reason: 'forbidden' },
    'a caller-supplied ancestor must not override the team tournament',
  )
  assert.equal(
    (
      await decision(owner.context, 'tournament.configure', {
        kind: 'tournament',
        tournamentId: 71,
      })
    ).ok,
    true,
  )
  assert.deepEqual(
    await decision(owner.context, 'tournament.configure', { kind: 'tournament', tournamentId: 72 }),
    { ok: false, reason: 'forbidden' },
  )

  assert.equal(
    (
      await decision(manager.context, 'tournament.check_in.write', {
        kind: 'tournament',
        tournamentId: 71,
      })
    ).ok,
    true,
  )
  assert.deepEqual(
    await decision(manager.context, 'tournament.results.write', {
      kind: 'tournament',
      tournamentId: 71,
    }),
    { ok: false, reason: 'forbidden' },
  )
  fixture.execute(
    `UPDATE identity_role_assignment
     SET expires_at = ?, revision = revision + 1, write_nonce = ? WHERE id = ?`,
    [now, opaque('l'), opaque('S')],
  )
  assert.deepEqual(
    await decision(manager.context, 'tournament.check_in.write', {
      kind: 'tournament',
      tournamentId: 71,
    }),
    { ok: false, reason: 'forbidden' },
    'an assignment is ineffective at its exact expiry',
  )
  fixture.execute(
    `UPDATE identity_registration_membership
     SET revoked_at = ?, revoke_reason = 'test revocation', revision = revision + 1,
         write_nonce = ? WHERE id = ?`,
    [now, opaque('m'), opaque('O')],
  )
  assert.deepEqual(
    await decision(manager.context, 'registration.edit', {
      kind: 'registration',
      registrationId: 711,
    }),
    { ok: false, reason: 'forbidden' },
    'relationship revocation is immediate',
  )
  assert.equal(
    (await decision(platformOwner.context, 'platform.configure', { kind: 'platform' })).ok,
    true,
  )
  assert.equal(
    (
      await decision(platformOwner.context, 'tournament.media.manage', {
        kind: 'tournament',
        tournamentId: 72,
      })
    ).ok,
    true,
  )
  assert.deepEqual(
    await decision(owner.context, 'platform.configure', { kind: 'tournament', tournamentId: 71 }),
    { ok: false, reason: 'invalid_request' },
  )
  assert.deepEqual(
    await decision(owner.context, 'registration.view', { kind: 'registration', registrationId: 0 }),
    { ok: false, reason: 'invalid_request' },
  )

  assert.equal(
    (
      await decision(nonPasskeyStaff.context, 'tournament.view', {
        kind: 'tournament',
        tournamentId: 71,
      })
    ).ok,
    true,
    'a recent non-Passkey authentication may enter a staff workspace',
  )
  assert.equal(
    (
      await decision(
        nonPasskeyStaff.context,
        'tournament.view',
        { kind: 'tournament', tournamentId: 71 },
        { assurance: 'base' },
      )
    ).assurance,
    'recent',
    'a caller cannot weaken or mislabel a capability minimum',
  )
  assert.equal(
    (await decision(reviewer.context, 'platform.identity.review', { kind: 'platform' })).ok,
    true,
  )
  assert.deepEqual(await decision(reviewer.context, 'platform.configure', { kind: 'platform' }), {
    ok: false,
    reason: 'forbidden',
  })
  assert.deepEqual(
    await decision(staleNonPasskeyStaff.context, 'tournament.view', {
      kind: 'tournament',
      tournamentId: 71,
    }),
    { ok: false, reason: 'assurance_required' },
  )
  assert.deepEqual(
    await authorize(
      owner.context,
      'tournament.view',
      { kind: 'tournament', tournamentId: 71 },
      {
        database: db,
        now: now + 16 * 60 * 1000,
        assurance: 'recent_phishing_resistant',
      },
    ),
    { ok: false, reason: 'assurance_required' },
  )

  const intentId = fixture.createRecoveryProof()
  const recovery = await fixture.session(accountIds.recovery, {
    method: 'oidc',
    recovery: { authIntentId: intentId },
  })
  assert.deepEqual(
    await decision(recovery.context, 'registration.view', {
      kind: 'registration',
      registrationId: 711,
    }),
    { ok: false, reason: 'recovery_restricted' },
  )

  await revokeSession(owner.context, 'security_test', { database: db, now: now + 1 })
  assert.deepEqual(
    await authorize(
      owner.context,
      'registration.view',
      { kind: 'registration', registrationId: 711 },
      { database: db, now: now + 1 },
    ),
    { ok: false, reason: 'session_invalid' },
  )
  assert.deepEqual(
    await authorize(
      { kind: 'anonymous' },
      'registration.view',
      { kind: 'registration', registrationId: 711 },
      { database: db, now },
    ),
    { ok: false, reason: 'anonymous' },
  )
  assert.deepEqual(
    await authorize(
      { ...platformOwner.context },
      'platform.configure',
      { kind: 'platform' },
      { database: db, now },
    ),
    { ok: false, reason: 'invalid_request' },
    'a caller-constructed context cannot become a credential',
  )
  console.log('unified identity authorization kernel tests passed')
} finally {
  database.close()
}

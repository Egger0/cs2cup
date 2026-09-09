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
    return nextResolve(specifier, context)
  },
})

const { accountIds, createIdentityKernelFixture, passwordCredentialIds } =
  await import('./identity-kernel-test-fixture.mjs')

const fixture = await createIdentityKernelFixture()
const { database, db, execute, now } = fixture
const { acceptRosterClaimRequest, claimRosterSeat, listIncomingRosterClaimRequests } =
  await import('../lib/identity/roster-claim.ts')

try {
  execute(
    `INSERT INTO player (id, team_id, nickname, sort_order)
     VALUES (710, 711, 'Claimed only after consent', 1)`,
  )
  const target = await fixture.session(accountIds.weakStaff, {
    method: 'password',
    passwordCredentialId: passwordCredentialIds.weakStaff,
  })
  const request = await claimRosterSeat(db, {
    playerId: 710,
    accountId: accountIds.weakStaff,
    authorisedByAccountId: accountIds.owner,
    reason: 'Captain invited the player',
    now: now + 1,
  })
  assert.equal(request.ok, true)
  if (!request.ok) throw new Error('Expected roster claim request')
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM identity_registration_membership WHERE player_id = 710`,
      )
      .get().count,
    0,
    'an invitation must never publish a player record before the target accepts',
  )
  assert.equal((await listIncomingRosterClaimRequests(db, target.context, now + 2)).length, 1)

  const accepted = await acceptRosterClaimRequest(db, target.context, request.requestId, now + 3)
  assert.equal(accepted.ok, true)
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM identity_registration_membership
         WHERE player_id = 710 AND account_id = ? AND relationship = 'player' AND revoked_at IS NULL`,
      )
      .get(accountIds.weakStaff).count,
    1,
    'only the invited, authenticated account may create the player membership',
  )
  assert.equal((await listIncomingRosterClaimRequests(db, target.context, now + 4)).length, 0)

  console.log('roster claim acceptance tests passed')
} finally {
  database.close()
}

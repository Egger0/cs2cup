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

const { createApprovedTournamentRegistration } =
  await import('../lib/identity/tournament-registration.ts')
const { saveRegistrationDraft } = await import('../lib/identity/registration-workflow.ts')
const { createMembershipDraft } = await import('../lib/identity/membership.ts')
const { submitMembershipApplication } = await import('../lib/identity/membership-application.ts')
const { claimMembershipApplication, reviewMembershipApplication } =
  await import('../lib/identity/membership-review.ts')
const { changeMembershipStatus } = await import('../lib/identity/membership-roster.ts')
const { accountIds, createIdentityKernelFixture, credentialIds, passwordCredentialIds } =
  await import('./identity-kernel-test-fixture.mjs')

const fixture = await createIdentityKernelFixture()
const { database, db, now } = fixture

async function approveMembership(applicant, reviewer) {
  const draft = await createMembershipDraft(
    db,
    applicant,
    {
      identityClaim: 'Tournament registration gate test',
      contact: 'owner@example.test',
      applicationReason: 'Eligibility test',
    },
    { now: now + 1 },
  )
  assert.equal(draft.ok, true)
  const submitted = await submitMembershipApplication(
    db,
    applicant,
    { applicationId: draft.application.id, revision: draft.application.revision },
    { now: now + 2 },
  )
  assert.equal(submitted.ok, true)
  const claimed = await claimMembershipApplication(
    db,
    reviewer,
    { applicationId: submitted.application.id, revision: submitted.application.revision },
    { now: now + 3 },
  )
  assert.equal(claimed.ok, true)
  const approved = await reviewMembershipApplication(
    db,
    reviewer,
    {
      applicationId: claimed.application.id,
      revision: claimed.application.revision,
      submissionVersion: claimed.application.submissionVersion,
      submissionDigest: claimed.application.submissionDigest,
      decision: 'approved',
      reasonCategory: 'eligible',
      reason: 'Approved for registration gate test',
    },
    { now: now + 4 },
  )
  assert.equal(approved.ok, true)
}

function registration(tag) {
  return {
    tournamentId: 72,
    team: {
      name: `Team ${tag}`,
      tag,
      captain: 'Captain',
      contact: 'owner@example.test',
      dept: '',
      note: '',
      players: Array.from({ length: 5 }, (_, index) => ({
        nickname: `${tag} Player ${index + 1}`,
        substitute: false,
      })),
    },
    managementTokenHash: tag.at(-1).repeat(64).toLowerCase(),
    fingerprint: `gate-test-${tag}`,
    now: now + 10,
  }
}

try {
  const applicant = await fixture.session(accountIds.owner, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.owner,
  })
  const pendingApplicant = await fixture.session(accountIds.manager, {
    method: 'passkey',
    authenticatorCredentialId: credentialIds.manager,
  })
  const reviewer = await fixture.session(accountIds.reviewer, {
    method: 'password',
    passwordCredentialId: passwordCredentialIds.reviewer,
  })

  const pendingResult = await createApprovedTournamentRegistration(
    db,
    pendingApplicant.context,
    registration('GAT1'),
  )
  assert.deepEqual(pendingResult, { ok: false, reason: 'authorization_changed' })
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM team WHERE tag = 'GAT1'").get().count,
    0,
  )

  await approveMembership(applicant.context, reviewer.context)
  await saveRegistrationDraft(db, applicant.context, {
    tournamentId: 72,
    values: {
      name: 'Team GAT2',
      tag: 'GAT2',
      captain: 'Captain',
      contact: 'owner@example.test',
      dept: '',
      note: '',
      players: ['One', 'Two', 'Three', 'Four', 'Five', ''],
    },
    now: now + 5,
  })
  const approvedResult = await createApprovedTournamentRegistration(
    db,
    applicant.context,
    registration('GAT2'),
  )
  assert.equal(approvedResult.ok, true)
  const created = database
    .prepare(
      `SELECT team.id, team.management_token_hash, relationship.account_id, relationship.relationship,
              (SELECT COUNT(*) FROM player WHERE team_id = team.id) AS players
       FROM team JOIN identity_registration_membership AS relationship
         ON relationship.team_id = team.id AND relationship.revoked_at IS NULL
       WHERE team.tag = 'GAT2'`,
    )
    .get()
  assert.deepEqual(
    { accountId: created.account_id, relationship: created.relationship, players: created.players },
    { accountId: accountIds.owner, relationship: 'owner', players: 5 },
  )
  assert.equal(created.management_token_hash, null)
  assert.equal(
    database
      .prepare(
        'SELECT COUNT(*) AS count FROM identity_registration_draft WHERE account_id = ? AND tournament_id = 72',
      )
      .get(accountIds.owner).count,
    0,
  )

  const membership = database
    .prepare('SELECT id, revision FROM identity_membership WHERE account_id = ?')
    .get(accountIds.owner)
  assert.deepEqual(
    await changeMembershipStatus(
      db,
      reviewer.context,
      {
        membershipId: membership.id,
        revision: membership.revision,
        operation: 'revoke',
        reason: 'Eligibility withdrawn for gate test',
      },
      { now: now + 11 },
    ),
    { ok: true, status: 'revoked' },
  )
  const revokedResult = await createApprovedTournamentRegistration(db, applicant.context, {
    ...registration('GAT3'),
    now: now + 12,
  })
  assert.deepEqual(revokedResult, { ok: false, reason: 'authorization_changed' })
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM team WHERE tag = 'GAT3'").get().count,
    0,
  )
  assert.equal(
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM registration_attempt WHERE fingerprint = 'gate-test-GAT3'",
      )
      .get().count,
    0,
  )

  console.log('identity tournament registration gate tests passed')
} finally {
  database.close()
}

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getPlatformProxy } from 'wrangler'

import { registerAccount } from '../lib/identity/account-registration.ts'
import { deriveIdentitySubkey } from '../lib/identity/internal/derived-key.ts'
import { bootstrapLegacyPlatformOwner } from '../lib/identity/legacy-owner-bootstrap.ts'
import {
  createMembershipDraft,
  submitMembershipApplication,
} from '../lib/identity/membership-service.ts'
import { createOpaqueToken, hashOpaqueToken } from '../lib/opaque-token.ts'
import { hashRegistrationToken } from '../lib/registration-access.ts'
import { BROWSER_LEGACY, BROWSER_USERS } from './identity-browser-users.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_PATH = join(ROOT, 'wrangler.local.jsonc')
const PERSIST_PATH = join(ROOT, '.local', 'cloudflare', 'v3')
const cleanRange = async () => new Response('')

function registrationFields(user) {
  return {
    username: user.username,
    displayName: user.displayName,
    password: user.password,
    passwordConfirmation: user.password,
  }
}

async function registeredContext(database, registration) {
  const row = await database
    .prepare(
      `SELECT account.display_name, account.verification_state,
              session.auth_method, session.created_at, session.last_seen_at,
              session.idle_expires_at, session.absolute_expires_at,
              session.authenticated_at, session.phishing_resistant_at,
              session.recovery_verified_at, session.recovery_restricted
       FROM identity_account AS account
       JOIN identity_session AS session ON session.account_id = account.id
       WHERE account.id = ? AND session.id = ?`,
    )
    .bind(registration.accountId, registration.sessionId)
    .first()
  if (!row) throw new Error('Browser fixture registration session is unavailable')
  return {
    kind: 'authenticated',
    account: {
      id: registration.accountId,
      displayName: row.display_name,
      verificationState: row.verification_state,
    },
    session: {
      id: registration.sessionId,
      authMethod: row.auth_method,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      idleExpiresAt: row.idle_expires_at,
      absoluteExpiresAt: row.absolute_expires_at,
      authenticatedAt: row.authenticated_at,
      phishingResistantAt: row.phishing_resistant_at,
      recoveryVerifiedAt: row.recovery_verified_at,
      recoveryRestricted: row.recovery_restricted === 1,
    },
  }
}

const proxy = await getPlatformProxy({
  configPath: CONFIG_PATH,
  envFiles: [join(ROOT, 'wrangler.local.env')],
  persist: { path: PERSIST_PATH },
  remoteBindings: false,
})

try {
  const database = proxy.env.CS2CUP_DB
  const key = await deriveIdentitySubkey(
    proxy.env.REGISTRATION_FINGERPRINT_SECRET,
    'cs2cup/identity/password-pepper/v1',
  )
  const pepper = Object.freeze({ version: 1, key })
  const peppers = Object.freeze({ active: pepper, byVersion: new Map([[1, pepper]]) })
  const now = Date.now()
  const applicantCreatedAt = now - 30 * 60 * 60 * 1000

  const legacyTournament = await database
    .prepare("SELECT id FROM tournament WHERE slug = '2026-nlc' LIMIT 1")
    .first()
  if (!legacyTournament) throw new Error('Browser fixture tournament is unavailable')
  await database
    .prepare(
      `INSERT INTO team
        (tournament_id, name, tag, captain, contact, status, management_token_hash)
       VALUES (?, ?, ?, ?, 'legacy-browser@example.test', 'pending', ?)`,
    )
    .bind(
      legacyTournament.id,
      BROWSER_LEGACY.teamName,
      BROWSER_LEGACY.teamTag,
      BROWSER_LEGACY.displayName,
      await hashRegistrationToken(BROWSER_LEGACY.managementToken),
    )
    .run()

  const applicant = await registerAccount(
    database,
    registrationFields(BROWSER_USERS.applicant),
    peppers,
    { now: applicantCreatedAt, fetcher: cleanRange },
  )
  const reviewer = await registerAccount(
    database,
    registrationFields(BROWSER_USERS.reviewer),
    peppers,
    { now: now - 60 * 60 * 1000, fetcher: cleanRange },
  )
  const rejectee = await registerAccount(
    database,
    registrationFields(BROWSER_USERS.rejectee),
    peppers,
    { now: applicantCreatedAt + 1_000, fetcher: cleanRange },
  )
  if (!applicant.ok || !reviewer.ok || !rejectee.ok) {
    throw new Error('Unable to create browser fixture accounts')
  }

  const legacyToken = createOpaqueToken()
  const legacyHash = await hashOpaqueToken(legacyToken)
  await database
    .prepare('INSERT INTO admin_session (token_hash, admin_id, expires_at) VALUES (?, 1, ?)')
    .bind(legacyHash, now + 60 * 60 * 1000)
    .run()
  const owner = await bootstrapLegacyPlatformOwner(
    database,
    legacyHash,
    registrationFields(BROWSER_USERS.owner),
    peppers,
    { now: now - 30 * 60 * 1000, fetcher: cleanRange },
  )
  if (!owner.ok) throw new Error(`Unable to create browser fixture owner: ${owner.reason}`)

  await database
    .prepare(
      `INSERT INTO identity_role_assignment
        (id, account_id, role, scope_type, granted_by_account_id, grant_reason, granted_at)
       VALUES (?, ?, 'identity_reviewer', 'platform', ?, 'browser fixture', ?)`,
    )
    .bind(createOpaqueToken(), reviewer.accountId, owner.accountId, now - 20 * 60 * 1000)
    .run()

  const applicantContext = await registeredContext(database, applicant)
  const draft = await createMembershipDraft(
    database,
    applicantContext,
    {
      identityClaim: '计算机学院在读学生',
      contact: 'browser-fixture@example.test',
      applicationReason: '浏览器验收数据',
    },
    { now: applicantCreatedAt + 60_000 },
  )
  if (!draft.ok) throw new Error(`Unable to create browser membership draft: ${draft.reason}`)
  const submitted = await submitMembershipApplication(
    database,
    applicantContext,
    { applicationId: draft.application.id, revision: draft.application.revision },
    { now: applicantCreatedAt + 120_000 },
  )
  if (!submitted.ok) throw new Error(`Unable to submit browser membership: ${submitted.reason}`)

  const rejecteeContext = await registeredContext(database, rejectee)
  const rejectedDraft = await createMembershipDraft(
    database,
    rejecteeContext,
    {
      identityClaim: '待核验的外部参与者',
      contact: 'browser-rejectee@example.test',
      applicationReason: '浏览器拒绝流程验收数据',
    },
    { now: applicantCreatedAt + 61_000 },
  )
  if (!rejectedDraft.ok) {
    throw new Error(`Unable to create rejected browser membership: ${rejectedDraft.reason}`)
  }
  const rejectedSubmitted = await submitMembershipApplication(
    database,
    rejecteeContext,
    { applicationId: rejectedDraft.application.id, revision: rejectedDraft.application.revision },
    { now: applicantCreatedAt + 121_000 },
  )
  if (!rejectedSubmitted.ok) {
    throw new Error(`Unable to submit rejected browser membership: ${rejectedSubmitted.reason}`)
  }

  await database
    .prepare(
      `UPDATE identity_session
       SET revoked_at = ?, revoke_reason = 'browser fixture setup completed',
           revision = revision + 1, write_nonce = id
       WHERE account_id IN (?, ?, ?, ?) AND revoked_at IS NULL`,
    )
    .bind(now, applicant.accountId, reviewer.accountId, rejectee.accountId, owner.accountId)
    .run()

  console.log('Identity browser fixture ready')
} finally {
  await proxy.dispose()
}

import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
const bindingsModule = dataModule(
  `export function cloudflareBindings() { return globalThis.__legacyPasskeyBindings }`,
)
const passkeyModule = dataModule(`
  export function participantAuthenticationOptions() { throw new Error('not used') }
  export function participantRegistrationOptions() { throw new Error('not used') }
  export async function verifyParticipantAuthentication() {
    return globalThis.__legacyPasskeyVerification
  }
  export function verifyParticipantRegistration() { throw new Error('not used') }
`)
const configModule = dataModule(`
  export function resolveWebAuthnConfig() {
    return { rpName: 'Test', rpID: 'example.test', origin: 'https://example.test' }
  }
`)
const nextServerModule = dataModule('export class NextResponse {}')
const nextHeadersModule = dataModule(
  `export async function cookies() { throw new Error('Unexpected cookie access') }`,
)
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: dataModule('export {}'), shortCircuit: true }
    if (specifier === '../cloudflare-bindings.ts') {
      return { url: bindingsModule, shortCircuit: true }
    }
    if (specifier === '../participant-passkeys.ts') {
      return { url: passkeyModule, shortCircuit: true }
    }
    if (specifier === '../webauthn-config.ts') {
      return { url: configModule, shortCircuit: true }
    }
    if (specifier === 'next/server') return { url: nextServerModule, shortCircuit: true }
    if (specifier === 'next/headers') return { url: nextHeadersModule, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

const { completeVerifiedPasskeyAuthentication, passkeyAuthenticationCredential } =
  await import('../lib/identity/internal/passkey-authentication.ts')
const { issuePasskeyIntent, claimPasskeyIntentAttempt } =
  await import('../lib/identity/internal/passkey-intent.ts')
const { IdentityPasskeyError } = await import('../lib/identity/internal/passkey-shared.ts')
const { migrateLegacyParticipantCredential } =
  await import('../lib/identity/legacy-participant-migration.ts')
const { verifyPasskeySignIn } = await import('../lib/identity/passkeys.ts')
const { RecordingD1Database } = await import('./recording-d1-fixture.mjs')
const { createMigratedDatabase } = await import('./sqlite-fixture.mjs')

const now = 2_000_000_000_000
const opaque = character => character.repeat(43)

async function fixture(suffix) {
  const database = await createMigratedDatabase()
  const db = new RecordingD1Database(database)
  const principalId = `p_${opaque(suffix)}`
  const userHandle = opaque(suffix.toLowerCase())
  const credentialId = `legacy-auth-${suffix}`
  const publicKey = Buffer.from(`legacy-public-key-${suffix}`).toString('base64url')
  database
    .prepare(
      `INSERT INTO participant_principal (id, webauthn_user_handle, created_at)
       VALUES (?, ?, '2026-01-01 00:00:00')`,
    )
    .run(principalId, userHandle)
  database
    .prepare(
      `INSERT INTO participant_passkey_credential
        (credential_id, principal_id, public_key, counter, transports_json, device_type,
         backed_up, created_at)
       VALUES (?, ?, ?, 0, '["internal"]', 'multiDevice', 1, ?)`,
    )
    .run(credentialId, principalId, publicKey, now - 10_000)
  database
    .prepare(
      `INSERT INTO participant_session
        (token_hash, principal_id, credential_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run('a'.repeat(64), principalId, credentialId, now - 1_000, now + 60_000)
  return { database, db, principalId, userHandle, credentialId }
}

async function intent(db, at) {
  const issued = await issuePasskeyIntent(db, {
    purpose: 'passkey_sign_in',
    redirectKey: 'account',
    context: {},
    now: at,
  })
  const claimed = await claimPasskeyIntentAttempt(db, {
    purpose: 'passkey_sign_in',
    secret: issued.secret,
    now: at + 1,
  })
  return { issued, claimed }
}

function assertNoCutover(database, principalId) {
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM identity_account').get().count, 0)
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM identity_legacy_subject_map
         WHERE subject_type = 'participant_principal' AND subject_id = ?`,
      )
      .get(principalId).count,
    0,
  )
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM identity_cutover').get().count, 0)
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM participant_session').get().count, 1)
}

{
  const current = await fixture('I')
  try {
    globalThis.__legacyPasskeyBindings = { db: current.db, media: {} }
    globalThis.__legacyPasskeyVerification = { verified: false }
    const { issued } = await intent(current.db, now)
    const response = {
      id: current.credentialId,
      rawId: current.credentialId,
      type: 'public-key',
      response: {
        authenticatorData: 'unused',
        clientDataJSON: 'unused',
        signature: 'unused',
        userHandle: current.userHandle,
      },
      clientExtensionResults: {},
    }
    await assert.rejects(
      verifyPasskeySignIn({ ceremonySecret: issued.secret, response, now: now + 2 }),
      error => error instanceof IdentityPasskeyError && error.code === 'invalid_ceremony',
    )
    assertNoCutover(current.database, current.principalId)
  } finally {
    current.database.close()
    delete globalThis.__legacyPasskeyBindings
    delete globalThis.__legacyPasskeyVerification
  }
}

{
  const current = await fixture('F')
  try {
    const first = await intent(current.db, now + 100)
    const stale = await passkeyAuthenticationCredential(current.db, current.credentialId)
    assert.equal(stale.source, 'legacy_participant')
    assertNoCutover(current.database, current.principalId)
    current.db.beforeBatch = () => {
      current.database
        .prepare(
          `UPDATE participant_passkey_credential
           SET counter = 1, last_used_at = ?, revision = revision + 1, write_nonce = ?
           WHERE credential_id = ?`,
        )
        .run(now + 102, opaque('Z'), current.credentialId)
    }
    await assert.rejects(
      completeVerifiedPasskeyAuthentication(current.db, {
        intent: first.claimed,
        credential: stale,
        verification: { newCounter: 1, deviceType: 'multiDevice', backedUp: true },
        now: now + 103,
      }),
      error => error instanceof IdentityPasskeyError && error.code === 'conflict',
    )
    assertNoCutover(current.database, current.principalId)
    assert.equal(
      current.database
        .prepare('SELECT consumed_at FROM identity_auth_intent WHERE id = ?')
        .get(first.claimed.id).consumed_at,
      null,
    )

    const second = await intent(current.db, now + 200)
    const fresh = await passkeyAuthenticationCredential(current.db, current.credentialId)
    const result = await completeVerifiedPasskeyAuthentication(current.db, {
      intent: second.claimed,
      credential: fresh,
      verification: { newCounter: 2, deviceType: 'multiDevice', backedUp: true },
      now: now + 202,
    })
    assert.match(result.accountId, /^[A-Za-z0-9_-]{43}$/)
    assert.deepEqual(
      {
        ...current.database
          .prepare(
            `SELECT credential.counter, credential.revision, intent.consumed_at,
                    session.account_id
             FROM identity_passkey_credential AS credential
             JOIN identity_auth_intent AS intent ON intent.id = ?
             JOIN identity_session AS session ON session.passkey_auth_intent_id = intent.id
             WHERE credential.credential_id = ?`,
          )
          .get(second.claimed.id, current.credentialId),
      },
      { counter: 2, revision: 1, consumed_at: now + 202, account_id: result.accountId },
    )
    assert.equal(
      current.database.prepare('SELECT COUNT(*) AS count FROM participant_session').get().count,
      0,
    )
  } finally {
    current.database.close()
  }
}

function racingDatabase(base, credentialId, onWinner) {
  let mappedRead = false
  let fired = false
  const before = async sql => {
    if (sql.includes('FROM identity_legacy_subject_map')) mappedRead = true
    if (!fired && mappedRead && sql.includes('SELECT id FROM identity_account WHERE')) {
      fired = true
      onWinner(await migrateLegacyParticipantCredential(base, credentialId, now + 302))
    }
  }
  return {
    prepare(sql) {
      const statement = base.prepare(sql)
      return {
        bind(...values) {
          const bound = statement.bind(...values)
          return {
            async first() {
              await before(sql)
              return bound.first()
            },
            async all() {
              await before(sql)
              return bound.all()
            },
            async run() {
              return bound.run()
            },
          }
        },
      }
    },
    batch(statements) {
      return base.batch(statements)
    },
  }
}

{
  const current = await fixture('R')
  try {
    const authentication = await intent(current.db, now + 300)
    const credential = await passkeyAuthenticationCredential(current.db, current.credentialId)
    let winnerAccountId = null
    const racing = racingDatabase(current.db, current.credentialId, value => {
      winnerAccountId = value
    })
    const result = await completeVerifiedPasskeyAuthentication(racing, {
      intent: authentication.claimed,
      credential,
      verification: { newCounter: 1, deviceType: 'multiDevice', backedUp: true },
      now: now + 303,
    })
    assert.equal(result.accountId, winnerAccountId)
    assert.equal(
      current.database
        .prepare('SELECT counter FROM identity_passkey_credential WHERE credential_id = ?')
        .get(current.credentialId).counter,
      1,
    )
  } finally {
    current.database.close()
  }
}

console.log('identity legacy passkey authentication tests passed')

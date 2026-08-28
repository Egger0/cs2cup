import assert from 'node:assert/strict'

import {
  APPLICATION_SESSION_COOKIE,
  LEGACY_SESSION_COOKIE,
  applicationSessionCookieOptions,
  deleteApplicationSessionCookieOptions,
  resolveSessionAuthMode,
  selectSessionCredential,
} from '../lib/session-cookie.ts'

const artifactCanary = process.env.AUTH_ARTIFACT_CANARY ?? 'cookie-static-canary'
const forceArtifactFailure =
  process.env.AUTH_ARTIFACT_FORCE_FAILURE === 'session-cookie'
const applicationCredential = `opaque-application-${artifactCanary}`
const legacyCredential = `provider-legacy-${artifactCanary}`

assert.equal(APPLICATION_SESSION_COOKIE, '__Host-cs2cup-session')
assert.equal(LEGACY_SESSION_COOKIE, 'cs2cup_session')
assert.equal(resolveSessionAuthMode({}), 'legacy')
for (const mode of ['legacy', 'bridge', 'application']) {
  assert.equal(resolveSessionAuthMode({ SESSION_AUTH_MODE: mode }), mode)
}
for (const invalid of ['', 'LEGACY', ' bridge', 'bridge ', 'new', '0']) {
  assert.throws(
    () => resolveSessionAuthMode({ SESSION_AUTH_MODE: invalid }),
    /must be legacy, bridge, or application/,
  )
}

const both = { application: applicationCredential, legacy: legacyCredential }
for (const [mode, cookies, kind, value] of [
  ['legacy', both, 'legacy', legacyCredential],
  ['bridge', both, 'application', applicationCredential],
  ['application', both, 'application', applicationCredential],
  ['bridge', { legacy: legacyCredential }, 'legacy', legacyCredential],
  [
    'bridge',
    { application: '', legacy: legacyCredential },
    'application',
    '',
  ],
  ['bridge', { legacy: '' }, 'legacy', ''],
]) {
  const selected = selectSessionCredential(mode, cookies)
  assert.equal(
    !forceArtifactFailure && selected?.kind === kind && selected.value === value,
    true,
    'session credential precedence drifted',
  )
}
assert.equal(
  selectSessionCredential('application', { legacy: legacyCredential }) === null,
  true,
  'application mode accepted a legacy-only credential',
)
assert.equal(selectSessionCredential('bridge', {}), null)

const now = new Date('2026-08-28T08:00:00.900Z')
const deadline = new Date('2026-08-28T16:00:00.100Z')
const options = applicationSessionCookieOptions(deadline, now)
assert.deepEqual(options, {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/',
  priority: 'high',
  expires: deadline,
  maxAge: 28_799,
})
assert.equal('domain' in options, false)
assert.equal('partitioned' in options, false)

const deletion = deleteApplicationSessionCookieOptions()
assert.equal(deletion.httpOnly, true)
assert.equal(deletion.secure, true)
assert.equal(deletion.sameSite, 'strict')
assert.equal(deletion.path, '/')
assert.equal(deletion.priority, 'high')
assert.equal(deletion.maxAge, 0)
assert.equal(deletion.expires.getTime(), 0)
assert.equal('domain' in deletion, false)

for (const invalid of [
  'not-a-date',
  '2026-08-28T08:00:00.900Z',
  '2026-08-28T08:00:01.200Z',
]) {
  assert.throws(
    () => applicationSessionCookieOptions(invalid, now),
    /deadline/,
  )
}

console.log('application session cookie policy tests passed')

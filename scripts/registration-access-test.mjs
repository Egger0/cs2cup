import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith('.') || /\.[a-z]+$/i.test(specifier)) throw error
      return nextResolve(`${specifier}.ts`, context)
    }
  },
})

const { createRegistrationAccess, hashRegistrationToken, isRegistrationToken } =
  await import('../lib/registration-access.ts')
const { parseRegistrationForm } = await import('../lib/registration-form.ts')
const { default: nextConfig } = await import('../next.config.ts')

const headerRules = await nextConfig.headers()
const managementHeaders = headerRules.find(
  rule => rule.source === '/tournaments/:slug/registration/:token',
)
assert.ok(managementHeaders, 'management routes must define private response headers')
assert.deepEqual(
  Object.fromEntries(managementHeaders.headers.map(header => [header.key, header.value])),
  {
    'Cache-Control': 'private, no-cache, no-store, max-age=0, must-revalidate',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
  },
)

for (const source of ['/api/participant/:path*', '/login', '/me']) {
  const rule = headerRules.find(candidate => candidate.source === source)
  assert.ok(rule, `${source} must define private response headers`)
  assert.equal(
    rule.headers.find(header => header.key === 'Cache-Control')?.value,
    'private, no-cache, no-store, max-age=0, must-revalidate',
  )
}

const first = await createRegistrationAccess()
const second = await createRegistrationAccess()

assert.equal(first.token.length, 43)
assert.equal(first.tokenHash.length, 64)
assert.equal(isRegistrationToken(first.token), true)
assert.equal(await hashRegistrationToken(first.token), first.tokenHash)
assert.notEqual(first.token, second.token)
assert.notEqual(first.tokenHash, second.tokenHash)
assert.match(first.token, /^[A-Za-z0-9_-]{43}$/)
assert.match(first.tokenHash, /^[0-9a-f]{64}$/)

for (const invalid of ['', 'short', `${first.token}=`, `${first.token.slice(0, -1)}!`]) {
  assert.equal(isRegistrationToken(invalid), false)
  assert.equal(await hashRegistrationToken(invalid), null)
}

function registrationForm() {
  const form = new FormData()
  form.set('name', 'Alpha Team')
  form.set('tag', 'alpha')
  form.set('captain', 'Captain')
  form.set('contact', 'contact-id')
  form.set('dept', 'Engineering')
  form.set('note', 'First line\nSecond line')
  for (let index = 1; index <= 5; index += 1) form.set(`player${index}`, `Player ${index}`)
  form.set('player6', '')
  return form
}

const valid = parseRegistrationForm(registrationForm())
assert.equal(valid.ok, true)
assert.equal(valid.ok ? valid.values.tag : null, 'ALPHA')
assert.equal(valid.ok ? valid.values.note : null, 'First line\nSecond line')

const lineBreak = registrationForm()
lineBreak.set('name', 'Alpha\nTeam')
assert.equal(
  parseRegistrationForm(lineBreak).ok,
  false,
  'single-line fields must reject line breaks',
)

const fileValue = registrationForm()
fileValue.set('name', new Blob(['Alpha Team']), 'team.txt')
assert.equal(
  parseRegistrationForm(fileValue).ok,
  false,
  'file values must not be coerced into text',
)

console.log('registration access tests passed')

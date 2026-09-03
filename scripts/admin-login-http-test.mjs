import assert from 'node:assert/strict'

import {
  AdminLoginRequestError,
  MAX_ADMIN_PASSWORD_LENGTH,
  MAX_ADMIN_USERNAME_LENGTH,
  readAdminLoginRequest,
} from '../lib/admin-login-request.ts'

const endpoint = 'https://cup.example/admin/session'
const formRequest = (body, headers = {}) =>
  new Request(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', ...headers },
    body,
  })

async function expectRequestError(request) {
  await assert.rejects(
    () => readAdminLoginRequest(request),
    error => {
      assert.equal(error instanceof AdminLoginRequestError, true)
      assert.equal(error.name, 'AdminLoginRequestError')
      assert.doesNotMatch(error.message, /admin-login-secret-canary/)
      return true
    },
  )
}

assert.deepEqual(
  await readAdminLoginRequest(
    formRequest(new URLSearchParams({ username: ' local-admin ', password: ' secret value ' })),
  ),
  { username: 'local-admin', password: ' secret value ' },
)
const maximumFields = {
  username: 'u'.repeat(MAX_ADMIN_USERNAME_LENGTH),
  password: 'p'.repeat(MAX_ADMIN_PASSWORD_LENGTH),
}
assert.deepEqual(
  await readAdminLoginRequest(formRequest(new URLSearchParams(maximumFields))),
  maximumFields,
)
const maximumBody = `username=${'%20'.repeat(1_355)}local-admin&password=x`
assert.equal(new TextEncoder().encode(maximumBody).byteLength, 4 * 1024)
assert.deepEqual(await readAdminLoginRequest(formRequest(maximumBody)), {
  username: 'local-admin',
  password: 'x',
})

for (const contentType of ['text/plain', 'application/json', 'multipart/form-data']) {
  await expectRequestError(
    formRequest('username=local-admin&password=admin-login-secret-canary', {
      'Content-Type': contentType,
    }),
  )
}

for (const body of [
  '',
  'username=local-admin',
  'password=admin-login-secret-canary',
  'username=&password=admin-login-secret-canary',
  'username=local-admin&password=',
  'username=first&username=second&password=admin-login-secret-canary',
  'username=local-admin&password=first&password=admin-login-secret-canary',
  'username=local-admin&password=admin-login-secret-canary&next=%2Fadmin',
  `username=${'u'.repeat(MAX_ADMIN_USERNAME_LENGTH + 1)}&password=admin-login-secret-canary`,
  `username=local-admin&password=${'p'.repeat(MAX_ADMIN_PASSWORD_LENGTH + 1)}`,
  `username=${'中'.repeat(Math.floor(MAX_ADMIN_USERNAME_LENGTH / 3) + 1)}&password=x`,
  `username=local-admin&password=${'中'.repeat(Math.floor(MAX_ADMIN_PASSWORD_LENGTH / 3) + 1)}`,
]) {
  await expectRequestError(formRequest(body))
}

const declaredOversized = formRequest('username=local-admin&password=admin-login-secret-canary', {
  'Content-Length': String(4 * 1024 + 1),
})
await expectRequestError(declaredOversized)
assert.equal(declaredOversized.bodyUsed, false, 'declared oversized bodies must not be read')

let cancelled = false
const chunks = [
  new TextEncoder().encode(`username=local-admin&password=${'p'.repeat(3 * 1024)}`),
  new Uint8Array(2 * 1024),
]
const oversizedStream = new ReadableStream({
  pull(controller) {
    const chunk = chunks.shift()
    if (chunk) controller.enqueue(chunk)
    else controller.close()
  },
  cancel() {
    cancelled = true
  },
})
await expectRequestError(
  new Request(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: oversizedStream,
    duplex: 'half',
  }),
)
assert.equal(cancelled, true, 'oversized streamed login bodies must be cancelled')

console.log('admin login HTTP boundary tests passed')

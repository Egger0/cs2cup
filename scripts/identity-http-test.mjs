import assert from 'node:assert/strict'

import {
  IdentityRequestError,
  identityWantsJson,
  readIdentityForm,
} from '../lib/identity/internal/http.ts'

const request = body =>
  new Request('https://example.test/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })

assert.deepEqual(
  await readIdentityForm(request('username=player.one&password=a%20b'), ['username', 'password']),
  {
    username: 'player.one',
    password: 'a b',
  },
)
await assert.rejects(
  readIdentityForm(request('username=a&username=b&password=c'), ['username', 'password']),
  IdentityRequestError,
)
await assert.rejects(
  readIdentityForm(request('username=a&password=b&role=owner'), ['username', 'password']),
  IdentityRequestError,
)
await assert.rejects(
  readIdentityForm(
    new Request('https://example.test/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
    ['username'],
  ),
  IdentityRequestError,
)
await assert.rejects(
  readIdentityForm(request(`username=${'a'.repeat(9000)}`), ['username']),
  IdentityRequestError,
)
assert.equal(identityWantsJson(new Request('https://example.test')), false)
assert.equal(
  identityWantsJson(
    new Request('https://example.test', { headers: { accept: 'text/plain, application/json' } }),
  ),
  true,
)

console.log('identity HTTP request tests passed')

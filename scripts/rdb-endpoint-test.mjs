import assert from 'node:assert/strict'

import {
  rdbAuthorizationHeader,
  resolveRdbEndpoint,
} from '../lib/rdb-endpoint.ts'

const sentinel = 'must-not-leave-through-an-override'
const overrideEnvironment = {
  CLOUDBASE_ENV_ID: 'approved-staging',
  CLOUDBASE_ANON_KEY: sentinel,
  CLOUDBASE_ADMIN_KEY: sentinel,
  RDB_BASE_URL: 'https://evil.example/v1/rdb/rest',
  RDB_ADMIN_BASE_URL: 'https://admin-evil.example/v1/rdb/rest',
}
for (const credential of ['anon', 'admin']) {
  const endpoint = resolveRdbEndpoint(credential, overrideEnvironment)
  assert.equal(endpoint.cloudbaseGateway, false)
  assert.deepEqual(
    rdbAuthorizationHeader(endpoint, credential, overrideEnvironment),
    {},
  )
}

const officialEnvironment = {
  CLOUDBASE_ENV_ID: 'approved-staging',
  CLOUDBASE_ANON_KEY: 'publishable-key',
  CLOUDBASE_ADMIN_KEY: 'admin-key',
}
const officialAdmin = resolveRdbEndpoint('admin', officialEnvironment)
assert.equal(
  officialAdmin.baseUrl,
  'https://approved-staging.api.tcloudbasegateway.com/v1/rdb/rest',
)
assert.deepEqual(
  rdbAuthorizationHeader(officialAdmin, 'admin', officialEnvironment),
  { Authorization: 'Bearer admin-key' },
)

assert.throws(
  () => resolveRdbEndpoint('admin', { RDB_ADMIN_BASE_URL: 'https://user@evil.example/rest' }),
  /must not contain user information/,
)
assert.throws(
  () => resolveRdbEndpoint('anon', { RDB_BASE_URL: 'file:///tmp/database' }),
  /must use HTTP or HTTPS/,
)
assert.throws(
  () => resolveRdbEndpoint('anon', { CLOUDBASE_ENV_ID: 'good.example/escape' }),
  /unsupported URL characters/,
)

console.log('RDB endpoint provenance tests passed')

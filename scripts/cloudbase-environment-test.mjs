import assert from 'node:assert/strict'

import {
  cloudBaseGatewayUrl,
  fetchCloudBaseGateway,
  resolveCloudBaseEnvironmentId,
  resolveCloudBaseRegion,
  resolveCloudBaseSmokeTarget,
} from '../lib/cloudbase-environment.ts'

const officialEnvironment = { CLOUDBASE_ENV_ID: 'approved-staging' }
assert.equal(resolveCloudBaseEnvironmentId(officialEnvironment), 'approved-staging')
assert.equal(resolveCloudBaseRegion({ CLOUDBASE_REGION: 'ap-shanghai' }), 'ap-shanghai')
assert.equal(resolveCloudBaseRegion({}), undefined)
assert.equal(
  resolveCloudBaseSmokeTarget({
    CLOUDBASE_ENV_ID: 'approved-staging',
    CLOUDBASE_SMOKE_EXPECT_ENV_ID: 'approved-staging',
  }),
  'approved-staging',
)
assert.throws(
  () => resolveCloudBaseSmokeTarget({ CLOUDBASE_ENV_ID: 'approved-staging' }),
  /CLOUDBASE_SMOKE_EXPECT_ENV_ID is required/,
)
assert.equal(
  cloudBaseGatewayUrl('/auth/v1/signin', officialEnvironment),
  'https://approved-staging.api.tcloudbasegateway.com/auth/v1/signin',
)

const credentialSentinel = 'credential-must-stay-on-the-official-origin'
let observedRequest = null
const response = await fetchCloudBaseGateway(
  '/auth/v1/user/me',
  { headers: { Authorization: `Bearer ${credentialSentinel}` } },
  officialEnvironment,
  async (url, init) => {
    observedRequest = { url: String(url), authorization: init?.headers?.Authorization }
    return new Response('{}', { status: 200 })
  },
)
assert.equal(response?.ok, true)
assert.deepEqual(observedRequest, {
  url: 'https://approved-staging.api.tcloudbasegateway.com/auth/v1/user/me',
  authorization: `Bearer ${credentialSentinel}`,
})

for (const environmentId of [
  'approved.api.tcloudbasegateway.com@evil.example/',
  'good.example/escape',
  '-leading-hyphen',
  'trailing-hyphen-',
  'a'.repeat(64),
]) {
  let fetchCalled = false
  await assert.rejects(
    fetchCloudBaseGateway(
      '/auth/v1/signin',
      { method: 'POST', body: credentialSentinel },
      { CLOUDBASE_ENV_ID: environmentId },
      async () => {
        fetchCalled = true
        return new Response('{}')
      },
    ),
    /unsupported URL characters/,
  )
  assert.equal(fetchCalled, false)
}

for (const region of [
  'ap-shanghai.tcb-api.tencentcloudapi.com@evil.example',
  'ap/shanghai',
  '-ap-shanghai',
  'a'.repeat(64),
]) {
  assert.throws(
    () => resolveCloudBaseRegion({ CLOUDBASE_REGION: region }),
    /CLOUDBASE_REGION contains unsupported URL characters/,
  )
}

let escapedPathFetched = false
await assert.rejects(
  fetchCloudBaseGateway(
    '//evil.example/collect',
    { headers: { Authorization: `Bearer ${credentialSentinel}` } },
    officialEnvironment,
    async () => {
      escapedPathFetched = true
      return new Response('{}')
    },
  ),
  /must stay on the official origin/,
)
assert.equal(escapedPathFetched, false)

const originalFetch = globalThis.fetch
const smokeEnvironmentNames = [
  'CLOUDBASE_SMOKE_ACKNOWLEDGE_STAGING',
  'CLOUDBASE_SMOKE_PHASE',
  'CLOUDBASE_SMOKE_EXPECT_ENV_ID',
  'CLOUDBASE_ENV_ID',
  'CLOUDBASE_ANON_KEY',
  'CLOUDBASE_ADMIN_KEY',
]
const originalSmokeEnvironment = new Map(
  smokeEnvironmentNames.map(name => [name, process.env[name]]),
)
let smokeFetchCalled = false
try {
  Object.assign(process.env, {
    CLOUDBASE_SMOKE_ACKNOWLEDGE_STAGING: '1',
    CLOUDBASE_SMOKE_PHASE: 'expanded',
    CLOUDBASE_SMOKE_EXPECT_ENV_ID: 'independently-approved-staging',
    CLOUDBASE_ENV_ID: 'different-staging',
    CLOUDBASE_ANON_KEY: credentialSentinel,
    CLOUDBASE_ADMIN_KEY: credentialSentinel,
  })
  globalThis.fetch = async () => {
    smokeFetchCalled = true
    return new Response('{}')
  }
  await assert.rejects(
    import(`../scripts/cloudbase-rpc-smoke.mjs?target-mismatch=${Date.now()}`),
    /does not match CLOUDBASE_ENV_ID/,
  )
  assert.equal(smokeFetchCalled, false)
} finally {
  globalThis.fetch = originalFetch
  for (const [name, value] of originalSmokeEnvironment) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}

console.log('CloudBase environment provenance tests passed')

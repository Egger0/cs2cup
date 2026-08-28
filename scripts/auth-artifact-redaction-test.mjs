import { createHmac, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const prohibitedShapes = [
  /v1\.[A-Za-z0-9_-]{43}/u,
  /\\x[0-9a-f]{64}/iu,
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu,
  /(?:[0-9]{1,3}\.){3}[0-9]{1,3}/u,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu,
]

function gateFailure() {
  throw new Error('Authentication failure-artifact redaction gate failed')
}

function childResult(script, canary, mode) {
  return spawnSync(
    process.execPath,
    ['--conditions=react-server', '--experimental-strip-types', script],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        AUTH_ARTIFACT_CANARY: canary,
        AUTH_ARTIFACT_FORCE_FAILURE: mode ?? '',
      },
      maxBuffer: 2 * 1_024 * 1_024,
    },
  )
}

function scanArtifact(artifact, prohibitedValues) {
  for (const prohibited of prohibitedValues) {
    if (
      typeof prohibited !== 'string' ||
      prohibited.length === 0 ||
      artifact.includes(prohibited)
    ) {
      gateFailure()
    }
  }
  if (prohibitedShapes.some(pattern => pattern.test(artifact))) gateFailure()
}

async function verifyCase({ script, failureModes, prohibitedValues }) {
  const canary = `auth-artifact-${randomBytes(18).toString('hex')}`
  let dynamicValues
  try {
    dynamicValues = await prohibitedValues(canary)
  } catch {
    gateFailure()
  }
  if (!Array.isArray(dynamicValues)) gateFailure()
  const prohibited = [canary, ...dynamicValues]

  // These are the only CI executions of the sensitive unit tests. Their
  // stdout/stderr stays captured until every known dynamic credential and
  // identity sentinel has been checked.
  const normal = childResult(script, canary)
  const normalArtifact = `${normal.stdout}${normal.stderr}`
  scanArtifact(normalArtifact, prohibited)
  if (normal.error || normal.status !== 0 || normal.signal) {
    gateFailure()
  }

  for (const mode of failureModes) {
    const forced = childResult(script, canary, mode)
    const forcedArtifact = `${forced.stdout}${forced.stderr}`
    scanArtifact(forcedArtifact, prohibited)
    if (
      forced.error ||
      forced.status === 0 ||
      forced.signal ||
      !forcedArtifact.includes('AssertionError')
    ) {
      gateFailure()
    }
  }
}

for (const testCase of [
  {
    script: 'scripts/session-token-test.mjs',
    failureModes: ['session-token', 'session-token-redaction'],
    prohibitedValues: async canary => [
      `v1.${'A'.repeat(43)}`,
      `v1.${'A'.repeat(42)}!${canary}-do-not-echo`,
      '\\xdf4e1ae894615d0aaa4fb926759ad877c85f0fecd2fa6c8ddaa0b0b2109573d7',
    ],
  },
  {
    script: 'scripts/provider-proof-test.mjs',
    failureModes: ['provider', 'provider-transport'],
    prohibitedValues: async canary => [
      `provider-password-${canary}`,
      `provider-access-token-${canary}`,
      `provider-refresh-token-${canary}`,
      `provider-subject-${canary}`,
      `provider-profile-${canary}@example.test`,
      'Admin.CaseSensitive@example.test',
      'https://approved-staging.api.tcloudbasegateway.com/auth/v1',
    ],
  },
  {
    script: 'scripts/session-store-test.mjs',
    failureModes: ['session-store', 'session-store-transport'],
    prohibitedValues: async canary => [
      `https://approved.api.tcloudbasegateway.com/auth/v1/${canary}`,
      `verified-subject-${canary}`,
      `authorization-${canary}-transport-secret`,
      `v1.${'A'.repeat(43)}`,
      `v1.${'A'.repeat(42)}E`,
      '\\xdf4e1ae894615d0aaa4fb926759ad877c85f0fecd2fa6c8ddaa0b0b2109573d7',
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      `\\x${'ab'.repeat(32)}`,
    ],
  },
  {
    script: 'scripts/login-fingerprint-test.mjs',
    failureModes: ['login-fingerprint'],
    prohibitedValues: async canary => {
      const secret = 'login-test-secret-at-least-thirty-two-bytes'
      const material = `cs2cup:login-account-fingerprint:v1\0valid\0artifact-account-${canary}`
      return [
        `\\x${createHmac('sha256', secret).update(material).digest('hex')}`,
        secret,
        'Admin.CaseSensitive@example.test',
        '203.0.113.10',
        '::ffff:203.0.113.10',
        '0:0:0:0:0:ffff:cb00:710a',
        '2001:0db8:abcd:0012::1',
        '2001:db8:abcd:12:ffff:ffff:ffff:ffff',
        '2001:db8:abcd:12::1',
        '2001:db8:abcd:13::1',
      ]
    },
  },
  {
    script: 'scripts/session-cookie-test.mjs',
    failureModes: ['session-cookie'],
    prohibitedValues: async canary => [
      `opaque-application-${canary}`,
      `provider-legacy-${canary}`,
    ],
  },
  {
    script: 'scripts/csrf-test.mjs',
    failureModes: ['csrf-redaction'],
    prohibitedValues: async canary => [
      `https://${canary}.credential-value.invalid`,
    ],
  },
]) {
  await verifyCase(testCase)
}

console.log('captured authentication boundary and failure-artifact tests passed')

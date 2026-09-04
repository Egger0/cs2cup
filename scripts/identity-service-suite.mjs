import { spawnSync } from 'node:child_process'

const tests = [
  'identity-account-security-test.mjs',
  'identity-account-registration-test.mjs',
  'identity-account-profile-test.mjs',
  'identity-auth-fingerprint-test.mjs',
  'identity-auth-network-test.mjs',
  'identity-authorization-kernel-test.mjs',
  'identity-console-access-test.mjs',
  'identity-cas-verification-test.mjs',
  'identity-derived-key-test.mjs',
  'identity-enrollment-cookie-test.mjs',
  'identity-enrollment-policy-test.mjs',
  'identity-http-test.mjs',
  'identity-key-test.mjs',
  'identity-legacy-owner-bootstrap-test.mjs',
  'identity-legacy-passkey-authentication-test.mjs',
  'identity-legacy-participant-budget-test.mjs',
  'identity-legacy-participant-migration-test.mjs',
  'identity-legacy-participant-migration-race-test.mjs',
  'identity-legacy-participant-cutover-test.mjs',
  'identity-list-pagination-test.mjs',
  'identity-membership-policy-test.mjs',
  'identity-membership-operations-test.mjs',
  'identity-membership-review-route-test.mjs',
  'identity-membership-review-service-test.mjs',
  'identity-membership-service-test.mjs',
  'identity-passkey-policy-test.mjs',
  'identity-passkey-account-setup-test.mjs',
  'identity-passkey-service-test.mjs',
  'identity-password-authentication-test.mjs',
  'identity-password-config-test.mjs',
  'identity-password-screening-test.mjs',
  'identity-password-session-kernel-test.mjs',
  'identity-password-test.mjs',
  'identity-redirect-test.mjs',
  'identity-registration-management-test.mjs',
  'identity-registration-invitation-acceptance-test.mjs',
  'identity-registration-recovery-boundary-test.mjs',
  'identity-registration-workflow-test.mjs',
  'identity-security-event-test.mjs',
  'identity-self-registration-policy-test.mjs',
  'identity-session-kernel-test.mjs',
  'identity-tournament-registration-test.mjs',
  'identity-username-test.mjs',
]

for (const test of tests) {
  const result = spawnSync(
    process.execPath,
    ['--conditions=react-server', '--experimental-strip-types', `scripts/${test}`],
    { stdio: 'inherit' },
  )
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

console.log('all identity service tests passed')

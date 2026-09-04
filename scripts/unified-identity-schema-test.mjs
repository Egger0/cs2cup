const schemaTests = [
  './unified-identity-core-schema-test.mjs',
  './unified-identity-passkey-ceremony-schema-test.mjs',
  './unified-identity-recovery-schema-test.mjs',
  './unified-identity-recovery-context-schema-test.mjs',
  './unified-identity-attempt-schema-test.mjs',
  './unified-identity-access-schema-test.mjs',
  './identity-registration-workflow-schema-test.mjs',
  './unified-identity-operations-schema-test.mjs',
  './unified-identity-replace-guard-schema-test.mjs',
  './moderated-enrollment-schema-test.mjs',
  './moderated-membership-schema-test.mjs',
  './membership-review-operations-schema-test.mjs',
  './moderated-password-schema-test.mjs',
  './moderated-recovery-schema-test.mjs',
  './legacy-admin-bootstrap-schema-test.mjs',
  './legacy-cutover-session-guard-schema-test.mjs',
  './moderated-migration-upgrade-test.mjs',
]

for (const schemaTest of schemaTests) await import(schemaTest)

console.log('all unified identity schema tests passed')

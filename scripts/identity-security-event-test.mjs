import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const dataModule = code => `data:text/javascript,${encodeURIComponent(code)}`
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') return { url: dataModule('export {}'), shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

const { securityEventStatement } = await import('../lib/identity/internal/security-event.ts')
const bindings = []
const database = {
  prepare(sql) {
    assert.match(sql, /INSERT INTO identity_security_event/)
    return {
      bind(...values) {
        bindings.push(...values)
        return { run: async () => ({ success: true }) }
      },
    }
  },
}
const statement = await securityEventStatement(database, {
  eventType: 'account.signed_in',
  actor: { type: 'account', accountId: 'A'.repeat(43), sessionId: 'B'.repeat(43) },
  targetAccountId: 'A'.repeat(43),
  resource: { type: 'platform' },
  correlationId: 'C'.repeat(43),
  deduplicationScope: 'session:B',
  details: { method: 'password' },
  createdAt: 100,
})
await statement.run()
assert.equal(bindings[1], 'account.signed_in')
assert.equal(bindings[3], 'account')
assert.match(bindings[10], /^[0-9a-f]{64}$/)

await assert.rejects(
  securityEventStatement(database, {
    eventType: 'anonymous.failed',
    actor: { type: 'anonymous' },
    deduplicationScope: 'failure',
    retentionClass: 'anonymous_sampled',
    retentionUntil: 100,
    createdAt: 100,
  }),
  /retention/i,
)

console.log('identity security event construction passed')
